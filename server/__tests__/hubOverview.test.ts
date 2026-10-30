import { afterEach, describe, expect, it } from 'vitest';

import { parseNodeArg, toHubId } from '../src/hub/hubNodes.js';
import { HubOverview } from '../src/hub/hubOverview.js';
import { HubSession, type HubSocket } from '../src/hub/hubSession.js';

class FakeSocket implements HubSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, Array<(e: { data: unknown }) => void>> = {};
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
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

const NODES = [
  parseNodeArg('pc=http://127.0.0.1:3101/?token=a'),
  parseNodeArg('laptop=http://127.0.0.1:3102/?token=b'),
];

describe('hub overview for the secretary', () => {
  let overview: HubOverview;
  let sockets: FakeSocket[];

  function start() {
    sockets = [];
    overview = new HubOverview(NODES, () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    sockets.forEach((s) => s.open());
  }

  afterEach(() => overview.dispose());

  it('reports every machine and forwards to the right one', () => {
    start();
    sockets[0].receive({
      type: 'directoriesLoaded',
      directories: [{ name: 'Sport App', path: '/w/sport', source: 'user' }],
    });
    sockets[1].receive({
      type: 'directoriesLoaded',
      directories: [{ name: 'Roman', path: '/h/roman', source: 'user' }],
    });
    sockets[1].receive({
      type: 'agentCreated',
      id: 2,
      label: 'Wagner: Roman',
      directoryName: 'Roman',
    });
    sockets[1].receive({ type: 'agentToolPermission', id: 2 });

    const report = overview.call('lagebericht', {}).text;
    expect(report).toContain('laptop: Roman');
    expect(report).toContain(`id ${toHubId(1, 2)}: Wagner: Roman (wartet auf Freigabe)`);

    const projects = overview.call('projekte_auflisten', {}).text;
    expect(projects).toContain('Roman auf laptop (Wagner läuft)');
    expect(projects).toContain('Sport App auf pc (kein Wagner)');

    const forwarded = overview.call('nachricht_an_projektleiter', {
      projekt: 'roman',
      text: 'Hallo',
    });
    expect(forwarded.isError).toBeFalsy();
    expect(sockets[1].sent.at(-1)).toEqual({
      type: 'messageProjectLead',
      directoryPath: '/h/roman',
      text: 'Hallo',
    });
  });

  it('asks for the machine when a project name exists twice', () => {
    start();
    for (const s of sockets) {
      s.receive({
        type: 'directoriesLoaded',
        directories: [{ name: 'Website', path: '/w', source: 'user' }],
      });
    }
    expect(
      overview.call('nachricht_an_projektleiter', { projekt: 'Website', text: 'x' }).isError,
    ).toBe(true);
    overview.call('nachricht_an_projektleiter', { projekt: 'Website', rechner: 'pc', text: 'x' });
    expect(sockets[0].sent.at(-1)).toMatchObject({
      type: 'messageProjectLead',
      directoryPath: '/w',
    });
  });
});

describe('secretary started from a hub', () => {
  it('gets the hub endpoint passed to its node', () => {
    const sockets: FakeSocket[] = [];
    const session = new HubSession({
      nodes: NODES,
      send: () => {},
      hubSeats: () => ({}),
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      secretaryHubMcp: { url: 'https://pi.ts.net/mcp/hub', token: 'hubtoken' },
    });
    sockets.forEach((s) => s.open());
    session.route({ type: 'startSecretary' });
    expect(sockets[0].sent.at(-1)).toEqual({
      type: 'startSecretary',
      hubMcpUrl: 'https://pi.ts.net/mcp/hub',
      hubMcpToken: 'hubtoken',
    });
    session.dispose();
  });
});
