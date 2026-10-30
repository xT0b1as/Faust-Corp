/**
 * Bring up a Directory's project lead: set up its memory folder if missing,
 * then launch the lead with its role prompt, or select it when it is already
 * in the office. One lead per Directory.
 */

import type { HookProvider } from '../../../core/src/provider.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import type { HostDirectoryEntry } from '../directories.js';
import { listDirectories, normalizeDirectoryPath } from '../directories.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import { launchStandaloneAgent } from '../terminal/standaloneAgentLauncher.js';
import { MCP_SERVER_NAME, mcpConfigForAgent } from './mcpEndpoint.js';
import { ensureProjectScaffold } from './projectScaffold.js';
import { LEAD_NAME, leadPrompt } from './templates.js';

export interface StartProjectLeadDeps {
  store: AgentStateStore;
  runtime: AgentRuntime;
  ptyManager: PtySessionManager;
  provider: HookProvider;
  /** Every Directory this host knows, shown in the drawer or not. */
  hostDirectories: HostDirectoryEntry[];
  bypassPermissions: boolean;
}

export type StartProjectLeadResult =
  | { ok: true; agentId: number; launched: boolean; created: string[] }
  | { ok: false; reason: string };

export function startProjectLead(
  deps: StartProjectLeadDeps,
  directoryPath: string,
): StartProjectLeadResult {
  const key = normalizeDirectoryPath(directoryPath);
  // Only a known Directory: this writes into the folder, so it must be one the
  // user has named in the office, never an arbitrary path off the wire.
  const directory = listDirectories(deps.hostDirectories).find(
    (d) => normalizeDirectoryPath(d.path) === key,
  );
  if (!directory) {
    return { ok: false, reason: `Unbekanntes Projekt: ${directoryPath}` };
  }

  for (const [id, agent] of deps.store) {
    if (agent.projectRole === 'lead' && agent.directoryName === directory.name) {
      return { ok: true, agentId: id, launched: false, created: [] };
    }
  }

  let created: string[];
  try {
    created = ensureProjectScaffold(directory.path, directory.name).created;
  } catch (err) {
    return { ok: false, reason: `Projektordner konnte nicht angelegt werden: ${String(err)}` };
  }

  const agentId = launchStandaloneAgent(deps, {
    directoryPath: directory.path,
    prompt: leadPrompt(),
    label: `${LEAD_NAME}: ${directory.name}`,
    projectRole: 'lead',
    mcpConfigFor: mcpConfigForAgent,
    allowedTools: [`mcp__${MCP_SERVER_NAME}`],
    bypassPermissions: deps.bypassPermissions,
  });
  if (agentId === null) {
    return { ok: false, reason: 'Das Terminal ist nicht verfügbar.' };
  }
  if (created.length > 0) {
    console.log(`[Pixel Agents] Project: set up ${directory.name}: ${created.join(', ')}`);
  }
  return { ok: true, agentId, launched: true, created };
}
