/**
 * One browser's view of a hub office. For every connected browser the hub
 * opens its own upstream protocol connection to each node, so each node sends
 * this browser a full snapshot on connect, exactly as if it were a local client.
 *
 * Outbound (node to browser): office-owned messages (layout, assets, settings)
 * are dropped, since the hub serves its own; agent ids are moved into the
 * node's id range; Directories get the node in their path, so a later launch
 * can be routed back.
 *
 * Inbound (browser to node): agent-targeted messages go to the agent's node,
 * Directory-targeted ones to the Directory's node. Everything else is the
 * hub's own business and returns false, so the caller handles it locally.
 */

import {
  decodeNodePath,
  encodeNodePath,
  fromHubId,
  type HubNodeConfig,
  toHubId,
  wsUrl,
} from './hubNodes.js';

/** The slice of the WebSocket API a session needs (Node 22's global one fits). */
export interface HubSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export type HubSocketFactory = (url: string) => HubSocket;

const SOCKET_OPEN = 1;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** Node messages the hub replaces with its own. */
const HUB_OWNED = new Set([
  'layoutLoaded',
  'furnitureAssetsLoaded',
  'characterSpritesLoaded',
  'petSpritesLoaded',
  'floorTilesLoaded',
  'wallTilesLoaded',
  'carpetTilesLoaded',
  'officeAccess',
  'settingsLoaded',
  'bypassPermissionsUpdated',
  'hooksStatus',
  'hooksConsentRequest',
  'externalAssetDirectoriesUpdated',
  'areaMappingsLoaded',
  'providerCapabilities',
  'agentDiagnostics',
]);

/** Fields holding an agent id, in any message. */
const ID_FIELDS = ['id', 'agentId', 'parentAgentId', 'leadAgentId'] as const;
/** existingAgents maps keyed by agent id. */
const ID_KEYED_MAPS = ['agentMeta', 'directoryNames', 'labels', 'externalAgents'] as const;

interface DirectoryLike {
  name: string;
  path: string;
  source: string;
  account?: string;
}

interface NodeState {
  config: HubNodeConfig;
  socket: HubSocket | null;
  connected: boolean;
  agents: Set<number>;
  directories: DirectoryLike[];
  suggestions: string[];
  terminalAvailable: boolean;
  retryMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

export interface HubSessionOptions {
  nodes: HubNodeConfig[];
  /** Send to this browser. */
  send: (message: Record<string, unknown>) => void;
  /** Seat assignments the hub persisted, keyed by hub agent id. */
  hubSeats: () => Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
  socketFactory: HubSocketFactory;
  /** The hub's own MCP endpoint, handed to a secretary started from here so it
   *  sees every node. Absent when the hub has no public URL. */
  secretaryHubMcp?: { url: string; token: string };
}

export class HubSession {
  private readonly nodes: NodeState[];
  private disposed = false;

  constructor(private readonly options: HubSessionOptions) {
    this.nodes = options.nodes.map((config) => ({
      config,
      socket: null,
      connected: false,
      agents: new Set(),
      directories: [],
      suggestions: [],
      terminalAvailable: false,
      retryMs: RECONNECT_MIN_MS,
      retryTimer: null,
    }));
    this.nodes.forEach((_, index) => this.connect(index));
  }

  dispose(): void {
    this.disposed = true;
    for (const node of this.nodes) {
      if (node.retryTimer) clearTimeout(node.retryTimer);
      node.socket?.close();
    }
  }

  /** Names and connection state, for the hubNodes message. */
  nodeList(): Array<{ name: string; connected: boolean }> {
    return this.nodes.map((n) => ({ name: n.config.name, connected: n.connected }));
  }

  // ── Upstream ────────────────────────────────────────────────

  private connect(index: number): void {
    if (this.disposed) return;
    const node = this.nodes[index];
    let socket: HubSocket;
    try {
      socket = this.options.socketFactory(wsUrl(node.config, '/ws'));
    } catch (err) {
      console.warn(`[Pixel Agents] Hub: ${node.config.name}: ${String(err)}`);
      this.scheduleReconnect(index);
      return;
    }
    node.socket = socket;
    socket.addEventListener('open', () => {
      node.connected = true;
      node.retryMs = RECONNECT_MIN_MS;
      socket.send(JSON.stringify({ type: 'webviewReady' }));
      this.emitNodes();
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        this.fromNode(index, message);
      } catch {
        // Malformed frame from a node: ignore, like the local handler does.
      }
    });
    socket.addEventListener('error', () => {
      // 'close' follows and does the cleanup.
    });
    socket.addEventListener('close', () => {
      if (node.socket !== socket) return;
      node.socket = null;
      const wasConnected = node.connected;
      node.connected = false;
      for (const id of node.agents) this.options.send({ type: 'agentClosed', id });
      node.agents.clear();
      node.directories = [];
      node.terminalAvailable = false;
      if (wasConnected) {
        this.emitDirectories();
        this.emitTerminalAvailability();
        this.emitNodes();
      }
      this.scheduleReconnect(index);
    });
  }

  private scheduleReconnect(index: number): void {
    if (this.disposed) return;
    const node = this.nodes[index];
    node.retryTimer = setTimeout(() => {
      node.retryTimer = null;
      this.connect(index);
    }, node.retryMs);
    node.retryMs = Math.min(node.retryMs * 2, RECONNECT_MAX_MS);
  }

  private sendToNode(index: number, message: Record<string, unknown>): boolean {
    const socket = this.nodes[index]?.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  // ── Node → browser ──────────────────────────────────────────

  private fromNode(index: number, message: Record<string, unknown>): void {
    const node = this.nodes[index];
    const type = message.type as string;
    if (HUB_OWNED.has(type)) return;

    switch (type) {
      case 'directoriesLoaded':
        node.directories = (message.directories as DirectoryLike[]) ?? [];
        this.emitDirectories();
        return;
      case 'directorySaved':
        this.options.send({
          ...message,
          directory: this.hubDirectory(index, message.directory as DirectoryLike),
        });
        return;
      case 'directorySuggestions':
        node.suggestions = (message.paths as string[]) ?? [];
        this.options.send({
          type: 'directorySuggestions',
          paths: [...new Set(this.nodes.flatMap((n) => n.suggestions))],
        });
        return;
      case 'terminalAvailability':
        node.terminalAvailable = message.available === true;
        this.emitTerminalAvailability();
        return;
      case 'existingAgents':
        this.options.send(this.remapExisting(index, message));
        return;
      default:
        break;
    }

    const out: Record<string, unknown> = { ...message };
    for (const field of ID_FIELDS) {
      if (typeof out[field] === 'number') out[field] = toHubId(index, out[field] as number);
    }
    if (type === 'agentCreated') {
      node.agents.add(out.id as number);
      out.node = node.config.name;
    } else if (type === 'agentClosed') {
      node.agents.delete(out.id as number);
    }
    this.options.send(out);
  }

  private remapExisting(index: number, message: Record<string, unknown>): Record<string, unknown> {
    const node = this.nodes[index];
    const seats = this.options.hubSeats();
    const agents = ((message.agents as number[]) ?? []).map((id) => toHubId(index, id));
    agents.forEach((id) => node.agents.add(id));
    const out: Record<string, unknown> = { ...message, agents };
    for (const key of ID_KEYED_MAPS) {
      const map = (message[key] ?? {}) as Record<string, unknown>;
      out[key] = Object.fromEntries(
        Object.entries(map).map(([id, value]) => [String(toHubId(index, Number(id))), value]),
      );
    }
    // Seats belong to the hub's layout, not the node's.
    const meta = out.agentMeta as Record<string, Record<string, unknown>>;
    for (const id of agents) {
      const seat = seats[String(id)];
      meta[String(id)] = { ...(meta[String(id)] ?? {}), seatId: seat?.seatId };
    }
    return out;
  }

  private hubDirectory(index: number, directory: DirectoryLike): Record<string, unknown> {
    const node = this.nodes[index].config.name;
    return { ...directory, path: encodeNodePath(node, directory.path), node };
  }

  private emitDirectories(): void {
    this.options.send({
      type: 'directoriesLoaded',
      directories: this.nodes.flatMap((n, i) => n.directories.map((d) => this.hubDirectory(i, d))),
    });
  }

  private emitTerminalAvailability(): void {
    const available = this.nodes.some((n) => n.terminalAvailable);
    this.options.send({
      type: 'terminalAvailability',
      available,
      ...(available ? {} : { reason: 'Kein Rechner mit Terminal verbunden.' }),
    });
  }

  private emitNodes(): void {
    this.options.send({ type: 'hubNodes', nodes: this.nodeList() });
  }

  /** Called once the browser is ready, after the hub's own snapshot. */
  sendSnapshot(): void {
    this.emitNodes();
    this.emitDirectories();
    this.emitTerminalAvailability();
  }

  // ── Browser → node ──────────────────────────────────────────

  /** Route a privileged browser message. True when a node took it (or it was
   *  node-bound but undeliverable); false = handle it locally. */
  route(message: Record<string, unknown>): boolean {
    const nodeIndexByName = (name: unknown) => this.nodes.findIndex((n) => n.config.name === name);
    const byAgent = (field: 'id') => {
      const target = fromHubId(message[field] as number);
      if (!target || !this.nodes[target.nodeIndex]) return true;
      this.sendToNode(target.nodeIndex, { ...message, [field]: target.localId });
      return true;
    };
    const byPath = (field: 'directoryPath' | 'path', extra: Record<string, unknown> = {}) => {
      const decoded = decodeNodePath(String(message[field] ?? ''));
      const index = decoded ? nodeIndexByName(decoded.node) : -1;
      if (!decoded || index < 0) return true;
      this.sendToNode(index, { ...message, ...extra, [field]: decoded.path });
      return true;
    };
    const firstConnected = () => this.nodes.findIndex((n) => n.connected);

    switch (message.type) {
      case 'webviewReady':
        // The hub answers it locally (layout, settings); nodes were sent their
        // own on connect. The node-derived parts follow the local snapshot.
        return false;
      case 'focusAgent':
      case 'closeAgent':
      case 'agentCommand':
        return byAgent('id');
      case 'launchAgent':
      case 'startProjectLead':
      case 'messageProjectLead':
        return byPath('directoryPath');
      case 'removeDirectory':
        return byPath('path');
      case 'saveDirectory': {
        if (typeof message.previousPath === 'string') {
          // An edit stays on its Directory's node, whether or not the typed
          // path still carries the node prefix.
          const previous = decodeNodePath(message.previousPath);
          const index = previous ? nodeIndexByName(previous.node) : -1;
          if (!previous || index < 0) return true;
          const typed = String(message.path ?? '');
          const { node: _node, ...rest } = message;
          this.sendToNode(index, {
            ...rest,
            path: decodeNodePath(typed)?.path ?? typed,
            previousPath: previous.path,
          });
          return true;
        }
        const index = message.node !== undefined ? nodeIndexByName(message.node) : firstConnected();
        if (index >= 0) {
          const { node: _node, ...rest } = message;
          this.sendToNode(index, rest);
        }
        return true;
      }
      case 'requestDirectorySuggestions':
        this.nodes.forEach((_, i) => this.sendToNode(i, message));
        return true;
      case 'startSecretary': {
        // One secretary per office: it lives on the first connected node.
        const index = firstConnected();
        const hub = this.options.secretaryHubMcp;
        if (index >= 0) {
          this.sendToNode(
            index,
            hub ? { ...message, hubMcpUrl: hub.url, hubMcpToken: hub.token } : message,
          );
        }
        return true;
      }
      default:
        return false;
    }
  }
}
