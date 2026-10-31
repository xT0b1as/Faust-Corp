import { afterEach, describe, expect, it } from 'vitest';

import { parseNodeArg, toHubId } from '../src/hub/hubNodes.js';
import { HubSession, type HubSocket } from '../src/hub/hubSession.js';

class FakeSocket implements HubSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, Array<(e: { data: unknown }) => void>> = {};
  constructor(readonly url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
  addEventListener(type: string, listener: (e: { data: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: string, data?: unknown): void {
    for (const l of this.listeners[type] ?? []) l({ data });
  }
  open(): void {
    this.readyState = 1;
    this.emit('open');
  }
  receive(message: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(message));
  }
}

describe('hub', () => {
  let session: HubSession;
  let sockets: FakeSocket[];
  let toBrowser: Array<Record<string, unknown>>;

  function start() {
    sockets = [];
    toBrowser = [];
    session = new HubSession({
      nodes: [
        parseNodeArg('pc=https://pc.tailnet.ts.net/?token=t1'),
        parseNodeArg('laptop=http://127.0.0.1:3101/?token=t2'),
      ],
      send: (m) => toBrowser.push(m),
      hubSeats: () => ({ [String(toHubId(0, 1))]: { seatId: 'chair-7' } }),
      socketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    sockets.forEach((s) => s.open());
  }

  afterEach(() => session.dispose());

  it('connects to every node as a privileged client and asks for a snapshot', () => {
    start();
    expect(sockets.map((s) => s.url)).toEqual([
      'wss://pc.tailnet.ts.net/ws?token=t1',
      'ws://127.0.0.1:3101/ws?token=t2',
    ]);
    expect(sockets[0].sent).toEqual([{ type: 'webviewReady' }]);
  });

  it('moves node agents into the node id range and tags them', () => {
    start();
    sockets[1].receive({ type: 'agentCreated', id: 3, directoryName: 'Roman' });
    sockets[1].receive({ type: 'terminalSessionOpened', agentId: 3 });
    sockets[0].receive({ type: 'layoutLoaded', layout: {} });
    expect(toBrowser).toContainEqual({
      type: 'agentCreated',
      id: toHubId(1, 3),
      directoryName: 'Roman',
      node: 'laptop',
    });
    expect(toBrowser).toContainEqual({ type: 'terminalSessionOpened', agentId: toHubId(1, 3) });
    // The node's layout is the node's business; the hub serves its own.
    expect(toBrowser.some((m) => m.type === 'layoutLoaded')).toBe(false);
  });

  it('remaps a node snapshot and seats it from the hub', () => {
    start();
    sockets[0].receive({
      type: 'existingAgents',
      agents: [1],
      agentMeta: { 1: { palette: 2, seatId: 'node-seat' } },
      directoryNames: { 1: 'Sport App' },
      externalAgents: {},
    });
    const hubId = String(toHubId(0, 1));
    expect(toBrowser.at(-1)).toMatchObject({
      agents: [toHubId(0, 1)],
      agentMeta: { [hubId]: { palette: 2, seatId: 'chair-7' } },
      directoryNames: { [hubId]: 'Sport App' },
    });
  });

  it('merges Directories with the node in the path and routes launches back', () => {
    start();
    sockets[0].receive({
      type: 'directoriesLoaded',
      directories: [{ name: 'Sport App', path: '/w/sport', source: 'user' }],
    });
    sockets[1].receive({
      type: 'directoriesLoaded',
      directories: [{ name: 'Roman', path: '/h/roman', source: 'user' }],
    });
    expect(toBrowser.at(-1)).toEqual({
      type: 'directoriesLoaded',
      directories: [
        { name: 'Sport App', path: 'pc::/w/sport', source: 'user', node: 'pc' },
        { name: 'Roman', path: 'laptop::/h/roman', source: 'user', node: 'laptop' },
      ],
    });

    expect(session.route({ type: 'launchAgent', directoryPath: 'laptop::/h/roman' })).toBe(true);
    expect(sockets[1].sent.at(-1)).toEqual({ type: 'launchAgent', directoryPath: '/h/roman' });

    expect(session.route({ type: 'closeAgent', id: toHubId(0, 4) })).toBe(true);
    expect(sockets[0].sent.at(-1)).toEqual({ type: 'closeAgent', id: 4 });

    session.route({ type: 'saveDirectory', name: 'Neu', path: '/h/neu', node: 'laptop' });
    expect(sockets[1].sent.at(-1)).toEqual({ type: 'saveDirectory', name: 'Neu', path: '/h/neu' });

    // Office-owned messages stay with the hub.
    expect(session.route({ type: 'saveLayout', layout: {} })).toBe(false);
  });

  it("removes a node's agents when it drops and reports it", () => {
    start();
    sockets[0].receive({ type: 'agentCreated', id: 1 });
    sockets[0].close();
    expect(toBrowser).toContainEqual({ type: 'agentClosed', id: toHubId(0, 1) });
    expect(toBrowser).toContainEqual({
      type: 'hubNodes',
      nodes: [
        { name: 'pc', connected: false },
        { name: 'laptop', connected: true },
      ],
    });
  });

  it('rejects node arguments without a token or with a bad name', () => {
    expect(() => parseNodeArg('pc=https://pc.example')).toThrow(/token/);
    expect(() => parseNodeArg('p c=https://pc.example/?token=x')).toThrow(/name/);
  });
});
