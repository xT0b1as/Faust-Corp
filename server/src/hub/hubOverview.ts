/**
 * The hub's own, always-on view of every node, for the secretary's `faust-hub`
 * MCP server. It is a HubSession like a browser's, whose "browser" is this
 * class: it folds the remapped node messages into a small picture of who
 * works where, and routes the secretary's forwarding back to the right node.
 */

import type { McpTool, ToolResult } from '../projects/leadTools.js';
import type { McpToolProvider } from '../projects/mcpRoute.js';
import { Notifier } from '../projects/notifier.js';
import { SECRETARY_NAME } from '../projects/secretary.js';
import { LEAD_NAME } from '../projects/templates.js';
import { fromHubId, type HubNodeConfig } from './hubNodes.js';
import { HubSession, type HubSocketFactory } from './hubSession.js';

interface OverviewAgent {
  node: string;
  label?: string;
  directoryName?: string;
  status: string;
  contextPct?: number;
}

interface OverviewDirectory {
  name: string;
  path: string;
  node?: string;
  account?: string;
}

const STATUS_READY = 'bereit';
const STATUS_WORKING = 'arbeitet';
const STATUS_DONE = 'fertig';
const STATUS_PERMISSION = 'wartet auf Freigabe';

export const HUB_TOOLS: McpTool[] = [
  {
    name: 'lagebericht',
    description: 'Alle Agenten auf allen Rechnern, nach Rechner und Projekt geordnet, mit Status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'projekte_auflisten',
    description:
      'Alle Projekte auf allen Rechnern, mit Rechner, Konto und ob ihr Projektleiter läuft.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'nachricht_an_projektleiter',
    description:
      'Gibt eine Nachricht an den Projektleiter eines Projekts weiter, auf welchem Rechner es auch liegt. Startet ihn bei Bedarf.',
    inputSchema: {
      type: 'object',
      properties: {
        projekt: { type: 'string', description: 'Name des Projekts.' },
        rechner: {
          type: 'string',
          description: 'Nur nötig, wenn es den Projektnamen auf mehreren Rechnern gibt.',
        },
        text: { type: 'string' },
      },
      required: ['projekt', 'text'],
    },
  },
];

export class HubOverview {
  private readonly agents = new Map<number, OverviewAgent>();
  private directories: OverviewDirectory[] = [];
  private readonly session: HubSession;

  private readonly notifier: Notifier | null;

  constructor(
    private readonly nodes: HubNodeConfig[],
    socketFactory: HubSocketFactory,
    ntfyUrl?: string,
  ) {
    this.notifier = ntfyUrl
      ? new Notifier({
          url: ntfyUrl,
          nameOf: (id) => {
            const a = this.agents.get(id);
            return a ? `${a.label ?? a.directoryName ?? 'Agent'} @${a.node}` : undefined;
          },
          isImportant: (id) => {
            const label = this.agents.get(id)?.label ?? '';
            return label.startsWith(`${LEAD_NAME}:`) || label.startsWith(`${SECRETARY_NAME}:`);
          },
        })
      : null;
    this.session = new HubSession({
      nodes,
      send: (message) => this.apply(message),
      hubSeats: () => ({}),
      socketFactory,
    });
  }

  dispose(): void {
    this.session.dispose();
    this.notifier?.dispose();
  }

  private nodeOf(id: number): string {
    const at = fromHubId(id);
    return at ? (this.nodes[at.nodeIndex]?.name ?? '?') : '?';
  }

  /** Fold one remapped node message into the picture. */
  apply(message: Record<string, unknown>): void {
    this.notifier?.apply(message);
    const id = message.id as number;
    switch (message.type) {
      case 'agentCreated':
        this.agents.set(id, {
          node: (message.node as string) ?? this.nodeOf(id),
          label: message.label as string | undefined,
          directoryName: message.directoryName as string | undefined,
          status: STATUS_READY,
        });
        break;
      case 'existingAgents': {
        const labels = (message.labels ?? {}) as Record<string, string>;
        const names = (message.directoryNames ?? {}) as Record<string, string>;
        for (const agentId of (message.agents as number[]) ?? []) {
          if (this.agents.has(agentId)) continue;
          this.agents.set(agentId, {
            node: this.nodeOf(agentId),
            label: labels[String(agentId)],
            directoryName: names[String(agentId)],
            status: STATUS_READY,
          });
        }
        break;
      }
      case 'agentClosed':
        this.agents.delete(id);
        break;
      case 'agentStatus': {
        const agent = this.agents.get(id);
        if (agent) agent.status = message.status === 'active' ? STATUS_WORKING : STATUS_DONE;
        break;
      }
      case 'agentToolPermission': {
        const agent = this.agents.get(id);
        if (agent) agent.status = STATUS_PERMISSION;
        break;
      }
      case 'agentToolPermissionClear': {
        const agent = this.agents.get(id);
        if (agent) agent.status = STATUS_WORKING;
        break;
      }
      case 'agentContextUsage': {
        const agent = this.agents.get(id);
        const max = message.maxContextTokens as number;
        if (agent && max > 0) {
          agent.contextPct = Math.round(((message.contextTokens as number) / max) * 100);
        }
        break;
      }
      case 'directoriesLoaded':
        this.directories = (message.directories as OverviewDirectory[]) ?? [];
        break;
      default:
        break;
    }
  }

  private leadRunning(directory: OverviewDirectory): boolean {
    return [...this.agents.values()].some(
      (a) =>
        a.node === directory.node &&
        a.directoryName === directory.name &&
        a.label?.startsWith(`${LEAD_NAME}:`),
    );
  }

  call(name: string, args: Record<string, unknown>): ToolResult {
    switch (name) {
      case 'lagebericht': {
        const groups = new Map<string, string[]>();
        for (const [id, a] of this.agents) {
          const key = `${a.node}: ${a.directoryName ?? 'ohne Projekt'}`;
          const context = a.contextPct !== undefined ? `, Kontext ${a.contextPct}%` : '';
          const line = `  - id ${id}: ${a.label ?? a.directoryName ?? 'Chat'} (${a.status}${context})`;
          groups.set(key, [...(groups.get(key) ?? []), line]);
        }
        const offline = this.session
          .nodeList()
          .filter((n) => !n.connected)
          .map((n) => n.name);
        const text = [...groups].map(([key, lines]) => `${key}:\n${lines.join('\n')}`).join('\n');
        const note = offline.length > 0 ? `\nNicht verbunden: ${offline.join(', ')}` : '';
        return { text: (text || 'Im Büro arbeitet gerade niemand.') + note };
      }

      case 'projekte_auflisten': {
        const lines = this.directories.map((d) => {
          const lead = this.leadRunning(d) ? `${LEAD_NAME} läuft` : `kein ${LEAD_NAME}`;
          const account = d.account ? `, Konto ${d.account}` : '';
          return `- ${d.name} auf ${d.node ?? '?'}${account} (${lead})`;
        });
        return { text: lines.join('\n') || 'Keine Projekte eingetragen.' };
      }

      case 'nachricht_an_projektleiter': {
        const wanted = typeof args.projekt === 'string' ? args.projekt.trim().toLowerCase() : '';
        const node = typeof args.rechner === 'string' ? args.rechner.trim() : '';
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) return { text: 'Die Nachricht ist leer.', isError: true };
        const matches = this.directories.filter(
          (d) => d.name.toLowerCase() === wanted && (!node || d.node === node),
        );
        if (matches.length === 0) return { text: 'Dieses Projekt kenne ich nicht.', isError: true };
        if (matches.length > 1) {
          return {
            text: `Das Projekt gibt es auf mehreren Rechnern (${matches.map((d) => d.node).join(', ')}). Gib den Rechner an.`,
            isError: true,
          };
        }
        const target = matches[0];
        this.session.route({ type: 'messageProjectLead', directoryPath: target.path, text });
        return { text: `An ${LEAD_NAME} (${target.name} auf ${target.node}) weitergegeben.` };
      }

      default:
        return { text: `Unbekanntes Werkzeug: ${name}`, isError: true };
    }
  }

  asToolProvider(): McpToolProvider {
    return { tools: HUB_TOOLS, call: (name, args) => this.call(name, args) };
  }
}
