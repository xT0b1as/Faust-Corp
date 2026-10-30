/**
 * Where the office's MCP server listens, so a launch can hand a lead or the
 * secretary its own endpoint on the command line. Set once the HTTP server
 * listens (httpServer.ts).
 */

export const MCP_PATH_PREFIX = '/mcp/agent';
export const MCP_SERVER_NAME = 'faust';
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
