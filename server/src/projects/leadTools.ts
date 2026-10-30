/**
 * The project lead's tools, served over MCP (see mcpRoute.ts): start work
 * chats in its project, list them, message them, end them. Every tool is
 * scoped to the calling lead's own Directory; it can never reach another
 * project's agents.
 */

import type { HookProvider } from '../../../core/src/provider.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import type { HostDirectoryEntry } from '../directories.js';
import { listDirectories } from '../directories.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import { launchStandaloneAgent } from '../terminal/standaloneAgentLauncher.js';
import type { AgentState } from '../types.js';
import { submitToTerminal } from './agentCommands.js';

/** Name for work chats a lead starts without naming them: "Homunculus 1", 2, ... */
export const WORKER_NAME = 'Homunculus';

export interface LeadToolDeps {
  store: AgentStateStore;
  runtime: AgentRuntime;
  ptyManager: PtySessionManager;
  provider: HookProvider;
  hostDirectories: HostDirectoryEntry[];
  bypassPermissions: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const LEAD_TOOLS: McpTool[] = [
  {
    name: 'chat_starten',
    description:
      'Startet einen neuen Arbeitschat in diesem Projekt. Der Auftrag ist seine erste Nachricht; ' +
      'lege die Aufgabe vorher in .faust/aufgaben/ an und verweise im Auftrag darauf.',
    inputSchema: {
      type: 'object',
      properties: {
        auftrag: { type: 'string', description: 'Was der Chat erledigen soll.' },
        name: {
          type: 'string',
          description: `Name der Figur im Büro. Ohne Angabe: ${WORKER_NAME} 1, 2, ...`,
        },
      },
      required: ['auftrag'],
    },
  },
  {
    name: 'chats_auflisten',
    description:
      'Listet alle Chats dieses Projekts mit Status (arbeitet, fertig, wartet auf Freigabe) und Kontextfüllstand.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'chat_nachricht',
    description:
      'Schickt einem Chat dieses Projekts eine Nachricht, als hätte der Nutzer sie getippt.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'ID aus chats_auflisten.' },
        text: { type: 'string' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'chat_beenden',
    description:
      'Beendet einen Arbeitschat dieses Projekts. Erst beenden, wenn seine Übergabe oder sein Ergebnis vorliegt.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'ID aus chats_auflisten.' } },
      required: ['id'],
    },
  },
];

export interface ToolResult {
  text: string;
  isError?: boolean;
}

function projectAgents(store: AgentStateStore, lead: AgentState): Array<[number, AgentState]> {
  return [...store].filter(
    ([, agent]) => agent.directoryName === lead.directoryName && agent.leadAgentId === undefined,
  );
}

function statusOf(agent: AgentState): string {
  if (agent.permissionSent) return 'wartet auf Freigabe';
  if (agent.isWaiting) return 'fertig';
  if (agent.activeToolIds.size > 0) return 'arbeitet';
  return 'bereit';
}

function nextWorkerName(store: AgentStateStore, lead: AgentState): string {
  const taken = new Set<number>();
  for (const [, agent] of projectAgents(store, lead)) {
    const match = agent.label?.match(new RegExp(`^${WORKER_NAME} (\\d+)$`));
    if (match) taken.add(Number(match[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `${WORKER_NAME} ${n}`;
}

export function callLeadTool(
  deps: LeadToolDeps,
  leadId: number,
  name: string,
  args: Record<string, unknown>,
): ToolResult {
  const lead = deps.store.get(leadId);
  if (!lead || lead.projectRole !== 'lead') {
    return { text: 'Nur ein Projektleiter kann diese Werkzeuge nutzen.', isError: true };
  }
  const own = (id: unknown): AgentState | undefined => {
    if (typeof id !== 'number') return undefined;
    const agent = deps.store.get(id);
    return agent && agent.directoryName === lead.directoryName ? agent : undefined;
  };

  switch (name) {
    case 'chat_starten': {
      const auftrag = typeof args.auftrag === 'string' ? args.auftrag.trim() : '';
      if (!auftrag) return { text: 'Ein Auftrag ist nötig.', isError: true };
      const directory = listDirectories(deps.hostDirectories).find(
        (d) => d.name === lead.directoryName,
      );
      if (!directory) return { text: 'Das Projekt ist nicht mehr eingetragen.', isError: true };
      const label =
        (typeof args.name === 'string' && args.name.trim()) || nextWorkerName(deps.store, lead);
      const id = launchStandaloneAgent(deps, {
        directoryPath: directory.path,
        prompt: auftrag,
        label,
        bypassPermissions: deps.bypassPermissions,
      });
      if (id === null) return { text: 'Das Terminal ist nicht verfügbar.', isError: true };
      return { text: `Gestartet: ${label} (id ${id}).` };
    }

    case 'chats_auflisten': {
      const lines = projectAgents(deps.store, lead).map(([id, agent]) => {
        const role = agent.projectRole === 'lead' ? ', Projektleiter' : '';
        const context =
          agent.contextTokens > 0
            ? `, Kontext ${Math.round((agent.contextTokens / agent.maxContextTokens) * 100)}%`
            : '';
        const terminal = deps.ptyManager.has(id) ? '' : ', ohne Terminal';
        return `- id ${id}: ${agent.label ?? agent.directoryName ?? 'Chat'}${role} (${statusOf(agent)}${context}${terminal})`;
      });
      return { text: lines.join('\n') || 'Keine Chats.' };
    }

    case 'chat_nachricht': {
      const target = own(args.id);
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!target || !deps.ptyManager.has(target.id)) {
        return { text: 'Kein Chat mit Terminal unter dieser id in diesem Projekt.', isError: true };
      }
      if (target.id === leadId) return { text: 'Das bist du selbst.', isError: true };
      if (!text) return { text: 'Die Nachricht ist leer.', isError: true };
      void submitToTerminal(deps.ptyManager, target.id, text).catch(() => {});
      return { text: `Nachricht an id ${target.id} geschickt.` };
    }

    case 'chat_beenden': {
      const target = own(args.id);
      if (!target) return { text: 'Kein Chat unter dieser id in diesem Projekt.', isError: true };
      if (target.id === leadId) {
        return { text: 'Du kannst dich nicht selbst beenden.', isError: true };
      }
      deps.ptyManager.dispose(target.id);
      deps.runtime.closeAgent(target.id);
      return { text: `Beendet: id ${target.id}.` };
    }

    default:
      return { text: `Unbekanntes Werkzeug: ${name}`, isError: true };
  }
}
