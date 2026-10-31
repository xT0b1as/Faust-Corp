import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HookProvider } from '../../core/src/provider.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { saveUserDirectory } from '../src/directories.js';
import { startProjectLead } from '../src/projects/projectLead.js';
import { ensureProjectScaffold } from '../src/projects/projectScaffold.js';
import { CLAUDE_MD_MARKER, LEAD_NAME } from '../src/projects/templates.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { IPty, PtyModule, PtySpawnOptions } from '../src/terminal/ptyModule.js';
import { PtySessionManager } from '../src/terminal/ptySessionManager.js';

class FakePty implements IPty {
  readonly pid = 1;
  onData(): void {}
  onExit(): void {}
  write(): void {}
  resize(): void {}
  kill(): void {}
}

describe('project memory folder', () => {
  let project: string;

  beforeEach(() => {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-project-'));
  });
  afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

  it('creates .faust/ and a CLAUDE.md that imports it', () => {
    const { created } = ensureProjectScaffold(project, 'Sport App');

    expect(created).toContain('CLAUDE.md');
    expect(created).toContain(path.join('.faust', 'rollen', 'projektleiter.md'));
    expect(fs.readFileSync(path.join(project, '.faust', 'projekt.md'), 'utf-8')).toMatch(
      /^# Sport App/,
    );
    const claudeMd = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('@.faust/projekt.md');
    expect(claudeMd).toContain('@.faust/stand.md');
  });

  it('never overwrites existing files and appends to CLAUDE.md only once', () => {
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Mein Projekt\nEigene Regeln');
    fs.mkdirSync(path.join(project, '.faust'));
    fs.writeFileSync(path.join(project, '.faust', 'stand.md'), 'mein stand');

    ensureProjectScaffold(project, 'Sport App');
    const second = ensureProjectScaffold(project, 'Sport App');

    expect(second.created).toEqual([]);
    expect(fs.readFileSync(path.join(project, '.faust', 'stand.md'), 'utf-8')).toBe('mein stand');
    const claudeMd = fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd.startsWith('# Mein Projekt\nEigene Regeln\n\n')).toBe(true);
    expect(claudeMd.split(CLAUDE_MD_MARKER)).toHaveLength(2);
  });
});

describe('startProjectLead', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let project: string;
  let store: AgentStateStore;
  let runtime: AgentRuntime;
  let spawnArgs: Array<{ file: string; args: string[]; options: PtySpawnOptions }>;
  let ptyManager: PtySessionManager;

  function deps() {
    const provider: HookProvider = {
      ...claudeProvider,
      getSessionDirs: () => [path.join(tempHome, 'sessions')],
    };
    return {
      store,
      runtime,
      ptyManager,
      provider,
      hostDirectories: [],
      bypassPermissions: false,
    };
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-lead-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    project = path.join(tempHome, 'sport-app');
    fs.mkdirSync(project);
    fs.mkdirSync(path.join(tempHome, 'sessions'));
    store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    spawnArgs = [];
    const module: PtyModule = {
      spawn: (file, args, options) => {
        spawnArgs.push({ file, args, options });
        return new FakePty();
      },
    };
    ptyManager = new PtySessionManager(() => ({ module, moduleId: 'fake', reason: null }));
  });

  afterEach(() => {
    runtime.dispose();
    store.dispose();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('refuses a path that is no Directory', () => {
    const result = startProjectLead(deps(), project);
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(project, '.faust'))).toBe(false);
  });

  it('sets up the project and launches the lead once', () => {
    expect(saveUserDirectory({ name: 'Sport App', path: project }).ok).toBe(true);

    const first = startProjectLead(deps(), project);
    expect(first).toMatchObject({ ok: true, launched: true });
    expect(fs.existsSync(path.join(project, '.faust', 'rollen', 'projektleiter.md'))).toBe(true);

    const lead = store.get(first.ok ? first.agentId : -1);
    expect(lead?.label).toBe(`${LEAD_NAME}: Sport App`);
    expect(lead?.projectRole).toBe('lead');
    const args = spawnArgs[0].args;
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--') + 1]).toContain('.faust/rollen/projektleiter.md');

    // A second request selects the running lead instead of launching another.
    const second = startProjectLead(deps(), project);
    expect(second).toMatchObject({ ok: true, launched: false });
    expect(spawnArgs).toHaveLength(1);
  });
});
