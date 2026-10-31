import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { grantHooksConsent, setHooksEnabled } from '../src/configPersistence.js';
import { saveUserDirectory } from '../src/directories.js';
import { syncAccountHooks } from '../src/projects/accountHooks.js';
import { areHooksInstalled } from '../src/providers/hook/claude/claudeHookInstaller.js';

describe('hooks for extra Claude accounts', () => {
  let home: string;
  let originalHome: string | undefined;
  let account: string;

  const accountSettings = () => path.join(account, 'settings.json');

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-acct-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
    account = path.join(home, '.claude-arbeit');
    fs.mkdirSync(account);
    const project = path.join(home, 'work');
    fs.mkdirSync(project);
    saveUserDirectory({ name: 'Arbeit', path: project, account });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('writes nothing without consent', async () => {
    await syncAccountHooks([]);
    expect(fs.existsSync(accountSettings())).toBe(false);
  });

  it('installs into the account under granted consent and removes them again', async () => {
    grantHooksConsent('claude');
    await syncAccountHooks([], true);
    const written = fs.readFileSync(accountSettings(), 'utf-8');
    expect(written).toContain('/.pixel-agents/hooks/claude-hook.js');
    // The default account is untouched.
    expect(fs.existsSync(path.join(home, '.claude', 'settings.json'))).toBe(false);
    expect(areHooksInstalled()).toBe(false);

    setHooksEnabled('claude', false);
    await syncAccountHooks([]);
    expect(fs.readFileSync(accountSettings(), 'utf-8')).not.toContain('claude-hook.js');
  });

  it("keeps the account's own settings", async () => {
    fs.writeFileSync(
      accountSettings(),
      JSON.stringify({ theme: 'dark', permissions: { allow: ['Bash'] } }),
    );
    grantHooksConsent('claude');
    await syncAccountHooks([], true);
    const settings = JSON.parse(fs.readFileSync(accountSettings(), 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.permissions).toEqual({ allow: ['Bash'] });
    expect(fs.existsSync(`${accountSettings()}.pixel-agents.backup`)).toBe(true);
  });
});
