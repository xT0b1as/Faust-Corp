/**
 * A minimal MCP server (Streamable HTTP, JSON responses only, no SSE) through
 * which a project lead reaches its tools. One endpoint per lead,
 * `/mcp/agent/:agentId`, so every call knows whose project it acts on. Bearer
 * auth with the server's hook token, which only processes on this machine can
 * read (server.json) or were handed on their command line.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { LeadToolDeps } from './leadTools.js';
import { callLeadTool, LEAD_TOOLS } from './leadTools.js';

export const MCP_PATH_PREFIX = '/mcp/agent';
export const MCP_SERVER_NAME = 'faust';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Where a lead's MCP endpoint lives; set once the server listens. */
let endpoint: { port: number; token: string } | null = null;

export function setMcpEndpoint(port: number, token: string): void {
  endpoint = { port, token };
}

/** The `--mcp-config` JSON for one lead, or undefined before the server listens. */
export function mcpConfigForAgent(agentId: number): string | undefined {
  if (!endpoint) return undefined;
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${endpoint.port}${MCP_PATH_PREFIX}/${agentId}`,
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
    },
  });
}

function handle(
  deps: LeadToolDeps,
  agentId: number,
  message: JsonRpcRequest,
): Record<string, unknown> | null {
  // Notifications (no id) get no response body.
  if (message.id === undefined || message.id === null) return null;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion:
          typeof message.params?.protocolVersion === 'string'
            ? message.params.protocolVersion
            : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'faust-corp', version: process.env.PIXEL_AGENTS_VERSION ?? 'dev' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: LEAD_TOOLS });
    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : '';
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const result = callLeadTool(deps, agentId, name, args);
      return reply({
        content: [{ type: 'text', text: result.text }],
        isError: result.isError ?? false,
      });
    }
    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      };
  }
}

export function registerMcpRoute(
  app: FastifyInstance,
  auth: Auth,
  deps: () => LeadToolDeps | null,
): void {
  app.post<{ Params: { agentId: string }; Body: JsonRpcRequest | JsonRpcRequest[] }>(
    `${MCP_PATH_PREFIX}/:agentId`,
    { preHandler: auth },
    async (request, reply) => {
      const toolDeps = deps();
      if (!toolDeps) return reply.code(503).send('terminal unavailable');
      const agentId = Number(request.params.agentId);
      const body = request.body;
      const responses = (Array.isArray(body) ? body : [body])
        .map((message) => handle(toolDeps, agentId, message))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (responses.length === 0) return reply.code(202).send();
      return reply
        .header('content-type', 'application/json')
        .send(Array.isArray(body) ? responses : responses[0]);
    },
  );
  // No server-initiated stream: tell clients to stick to POST.
  app.get(`${MCP_PATH_PREFIX}/:agentId`, async (_request, reply) => reply.code(405).send());
}
