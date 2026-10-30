/**
 * Where the office's MCP server listens, so a launch can hand a lead or the
 * secretary its own endpoint. Set once the HTTP server listens (httpServer.ts).
 *
 * The config carries the server token, so it goes to the CLI as a FILE
 * (owner-only, 0600) rather than as a command-line argument, which every
 * local process could read from the process list.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from '../constants.js';

export const MCP_PATH_PREFIX = '/mcp/agent';
export const MCP_SERVER_NAME = 'faust';
const MCP_CONFIG_FOLDER = 'mcp';

let endpoint: { port: number; token: string } | null = null;

export function setMcpEndpoint(port: number, token: string): void {
  endpoint = { port, token };
}

export function mcpConfigDir(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, MCP_CONFIG_FOLDER);
}

/**
 * Write one agent's MCP config and return its path for `--mcp-config`, or
 * undefined before the server listens or when the file can't be written (the
 * agent then starts without its tools rather than not at all).
 */
export function mcpConfigForAgent(agentId: number): string | undefined {
  if (!endpoint) return undefined;
  const config = JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${endpoint.port}${MCP_PATH_PREFIX}/${agentId}`,
        headers: { Authorization: `Bearer ${endpoint.token}` },
      },
    },
  });
  const file = path.join(mcpConfigDir(), `agent-${agentId}.json`);
  try {
    fs.mkdirSync(mcpConfigDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, config, { encoding: 'utf-8', mode: 0o600 });
    // mode only applies on create; tighten a file left by an earlier run.
    fs.chmodSync(file, 0o600);
  } catch (err) {
    console.warn(`[Pixel Agents] MCP: could not write ${file}: ${String(err)}`);
    return undefined;
  }
  return file;
}
