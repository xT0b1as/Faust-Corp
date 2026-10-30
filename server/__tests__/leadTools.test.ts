import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { saveUserDirectory } from '../src/directories.js';
import type { LeadToolDeps } from '../src/projects/leadTools.js';
import { mcpConfigForAgent, setMcpEndpoint } from '../src/projects/mcpEndpoint.js';
import { registerMcpRoute } from '../src/projects/mcpRoute.js';
import { startProjectLead } from '../src/projects/projectLead.js';
import { secretaryDir, startSecretary } from '../src/projects/secretary.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { IPty, PtyModule } from '../src/terminal/ptyModule.js';
import { PtySessionManager } from '../src/terminal/ptySessionManager.js';

class FakePty implements IPty {
  readonly pid = 1;
  onData(): void {}
  onExit(): void {}
  write(): void {}
  resize(): void {}
  kill(): void {}
}

describe('project lead MCP tools', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let project: string;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let deps: LeadToolDeps;
  let spawned: string[][];
  const app = () => {
    const fastify = Fastify();
    registerMcpRoute(
      fastify,
      async (request, reply) => {
        if (request.headers.authorization !== 'Bearer secret') reply.code(401).send();
      },
      () => deps,
    );
    return fastify;
  };

  async function rpc(agentId: number, method: string, params: Record<string, unknown> = {}) {
    const response = await app().inject({
      method: 'POST',
      url: `/mcp/agent/${agentId}`,
      headers: { authorization: 'Bearer secret' },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    });
    return response.json() as { result: Record<string, unknown> };
  }

  async function tool(agentId: number, name: string, args: Record<string, unknown> = {}) {
    const { result } = await rpc(agentId, 'tools/call', { name, arguments: args });
    return result as { content: Array<{ text: string }>; isError: boolean };
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-mcp-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    project = path.join(tempHome, 'sport-app');
    fs.mkdirSync(project);
    fs.mkdirSync(path.join(tempHome, 'sessions'));
    saveUserDirectory({ name: 'Sport App', path: project });
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    spawned = [];
    const module: PtyModule = {
      spawn: (_file, args) => {
        spawned.push(args);
        return new FakePty();
      },
    };
    const provider: HookProvider = {
      ...claudeProvider,
      getSessionDirs: () => [path.join(tempHome, 'sessions')],
    };
    deps = {
      store,
      runtime,
      ptyManager: new PtySessionManager(() => ({ module, moduleId: 'fake', reason: null })),
      provider,
      hostDirectories: [],
      bypassPermissions: false,
    };
  });

  afterEach(() => {
    runtime.dispose();
    store.dispose();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('hands the lead its own MCP endpoint on the command line', () => {
    setMcpEndpoint(4321, 'secret');
    const result = startProjectLead(deps, project);
    const leadId = result.ok ? result.agentId : -1;
    const args = spawned[0];
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(config.mcpServers.faust.url).toBe(`http://127.0.0.1:4321/mcp/agent/${leadId}`);
    expect(config).toEqual(JSON.parse(mcpConfigForAgent(leadId)!));
  });

  it('serves initialize and the tool list', async () => {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const list = await rpc(1, 'tools/list');
    const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toEqual(['chat_starten', 'chats_auflisten', 'chat_nachricht', 'chat_beenden']);
  });

  it('rejects calls without the token', async () => {
    const response = await app().inject({
      method: 'POST',
      url: '/mcp/agent/1',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('lets the lead start, list and end work chats in its project', async () => {
    const lead = startProjectLead(deps, project);
    const leadId = lead.ok ? lead.agentId : -1;

    const started = await tool(leadId, 'chat_starten', { auftrag: 'Baue den Login' });
    expect(started.isError).toBe(false);
    expect(started.content[0].text).toContain('Homunculus 1');
    const workerArgs = spawned[1];
    expect(workerArgs[workerArgs.indexOf('--') + 1]).toBe('Baue den Login');

    await tool(leadId, 'chat_starten', { auftrag: 'Teste', name: 'Tester' });
    const listed = await tool(leadId, 'chats_auflisten');
    expect(listed.content[0].text).toContain('Projektleiter');
    expect(listed.content[0].text).toContain('Homunculus 1');
    expect(listed.content[0].text).toContain('Tester');

    const workerId = [...store].find(([, a]) => a.label === 'Homunculus 1')![0];
    const ended = await tool(leadId, 'chat_beenden', { id: workerId });
    expect(ended.isError).toBe(false);
    expect(store.has(workerId)).toBe(false);

    // The lead can't end itself, and a worker can't use the lead's tools.
    expect((await tool(leadId, 'chat_beenden', { id: leadId })).isError).toBe(true);
    const testerId = [...store].find(([, a]) => a.label === 'Tester')![0];
    expect((await tool(testerId, 'chats_auflisten')).isError).toBe(true);
  });

  it('gives the secretary the office-wide tools and lets it reach a lead', async () => {
    const sec = startSecretary(deps);
    const secId = sec.ok ? sec.agentId : -1;
    expect(fs.existsSync(path.join(secretaryDir(), 'CLAUDE.md'))).toBe(true);
    expect(startSecretary(deps)).toMatchObject({ ok: true, launched: false });

    const list = await rpc(secId, 'tools/list');
    const names = (list.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain('nachricht_an_projektleiter');

    const projects = await tool(secId, 'projekte_auflisten');
    expect(projects.content[0].text).toContain('Sport App');
    expect(projects.content[0].text).toContain('kein Wagner');

    const lead = startProjectLead(deps, project);
    const report = await tool(secId, 'lagebericht');
    expect(report.content[0].text).toContain('Wagner: Sport App');
    expect(report.content[0].text).not.toContain('Lynkeus');

    const forwarded = await tool(secId, 'nachricht_an_projektleiter', {
      projekt: 'sport app',
      text: 'Bitte Login priorisieren',
    });
    expect(forwarded.isError).toBe(false);
    expect(lead.ok).toBe(true);
    const stand = await tool(secId, 'projekt_stand', { projekt: 'Sport App' });
    expect(stand.content[0].text).toContain('# Stand');
  });
});
