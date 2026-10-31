/**
 * A minimal MCP server (Streamable HTTP, JSON responses only, no SSE) through
 * which a project lead reaches its tools. One endpoint per lead,
 * `/mcp/agent/:agentId`, so every call knows whose project it acts on. Bearer
 * auth with the server's hook token, which only processes on this machine can
 * read (server.json) or were handed on their command line.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { LeadToolDeps, McpTool, ToolResult } from './leadTools.js';
import { callLeadTool, LEAD_TOOLS } from './leadTools.js';
import { MCP_PATH_PREFIX } from './mcpEndpoint.js';
import { callSecretaryTool, SECRETARY_TOOLS } from './secretary.js';

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type Auth = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

function isSecretary(deps: LeadToolDeps, agentId: number): boolean {
  return deps.store.get(agentId)?.projectRole === 'secretary';
}

/** What an MCP endpoint serves: its tools and how to call one. */
export interface McpToolProvider {
  tools: McpTool[];
  call: (name: string, args: Record<string, unknown>) => ToolResult;
}

function handle(
  provider: McpToolProvider,
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
      return reply({ tools: provider.tools });
    case 'tools/call': {
      const name = typeof message.params?.name === 'string' ? message.params.name : '';
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      const result = provider.call(name, args);
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

/** One MCP endpoint at `path`; `provider` resolves per request (null = 503). */
export function registerMcpEndpoint<P extends Record<string, string>>(
  app: FastifyInstance,
  path: string,
  auth: Auth,
  provider: (params: P) => McpToolProvider | null,
): void {
  app.post<{ Params: P; Body: JsonRpcRequest | JsonRpcRequest[] }>(
    path,
    { preHandler: auth },
    async (request, reply) => {
      const tools = provider(request.params as P);
      if (!tools) return reply.code(503).send('unavailable');
      const body = request.body;
      const responses = (Array.isArray(body) ? body : [body])
        .map((message) => handle(tools, message))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (responses.length === 0) return reply.code(202).send();
      return reply
        .header('content-type', 'application/json')
        .send(Array.isArray(body) ? responses : responses[0]);
    },
  );
  // No server-initiated stream: tell clients to stick to POST.
  app.get(path, async (_request, reply) => reply.code(405).send());
}

/** The per-agent endpoint of a node: a lead's or the secretary's tools. */
export function registerMcpRoute(
  app: FastifyInstance,
  auth: Auth,
  deps: () => LeadToolDeps | null,
): void {
  registerMcpEndpoint<{ agentId: string }>(app, `${MCP_PATH_PREFIX}/:agentId`, auth, (params) => {
    const toolDeps = deps();
    if (!toolDeps) return null;
    const agentId = Number(params.agentId);
    return isSecretary(toolDeps, agentId)
      ? { tools: SECRETARY_TOOLS, call: (name, args) => callSecretaryTool(toolDeps, name, args) }
      : { tools: LEAD_TOOLS, call: (name, args) => callLeadTool(toolDeps, agentId, name, args) };
  });
}
