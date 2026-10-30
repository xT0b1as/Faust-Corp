import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveUserDirectory } from '../src/directories.js';
import { listTasks, parseTaskHeader, setTaskApproval } from '../src/projects/tasks.js';
import { accountUsage } from '../src/projects/usage.js';

describe('tasks and usage', () => {
  let home: string;
  let originalHome: string | undefined;
  let project: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tasks-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
    project = path.join(home, 'app');
    fs.mkdirSync(path.join(project, '.faust', 'aufgaben'), { recursive: true });
    saveUserDirectory({ name: 'App', path: project });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const task = (file: string, text: string) =>
    fs.writeFileSync(path.join(project, '.faust', 'aufgaben', file), text);

  it('parses the header and ignores comments', () => {
    expect(parseTaskHeader('---\nstatus: review   # done\nan: Homunculus 1\n---\n# T')).toEqual({
      status: 'review',
      an: 'Homunculus 1',
    });
  });

  it('lists tasks of every project, skipping the README', () => {
    task('README.md', '# Aufgaben');
    task('2026-10-30-login.md', '---\nstatus: offen\nfreigabe: noetig\n---\n\n# Login bauen\n');
    expect(listTasks([])).toEqual([
      {
        directoryPath: project,
        project: 'App',
        file: '2026-10-30-login.md',
        title: 'Login bauen',
        status: 'offen',
        approval: 'noetig',
      },
    ]);
  });

  it('records an approval in the header and refuses paths outside the folder', () => {
    task('a.md', '---\nstatus: offen\nfreigabe: noetig\n---\n# A\n');
    expect(setTaskApproval([], project, 'a.md', true)).toMatchObject({ ok: true, title: 'A' });
    expect(fs.readFileSync(path.join(project, '.faust', 'aufgaben', 'a.md'), 'utf-8')).toBe(
      '---\nstatus: offen\nfreigabe: erteilt\n---\n# A\n',
    );
    expect(setTaskApproval([], project, '../../x.md', true).ok).toBe(false);
    expect(setTaskApproval([], '/nowhere', 'a.md', true).ok).toBe(false);
  });

  it("sums today's tokens of an account from its transcripts", () => {
    const account = path.join(home, '.claude-b');
    const dir = path.join(account, 'projects', '-app');
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const record = (timestamp: string, usage: Record<string, number>) =>
      JSON.stringify({ type: 'assistant', timestamp, message: { usage } });
    fs.writeFileSync(
      path.join(dir, 's.jsonl'),
      [
        record(now.toISOString(), {
          input_tokens: 10,
          cache_creation_input_tokens: 5,
          output_tokens: 7,
          cache_read_input_tokens: 100,
        }),
        record('2020-01-01T00:00:00Z', { input_tokens: 999, output_tokens: 999 }),
        '{"type":"user"}',
      ].join('\n'),
    );
    expect(accountUsage(account, now)).toEqual({
      account,
      inputTokens: 15,
      outputTokens: 7,
      cacheReadTokens: 100,
      sessions: 1,
    });
  });
});
