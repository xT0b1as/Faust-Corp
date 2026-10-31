/**
 * Hooks for the extra Claude accounts a Directory can name (`account`, a
 * CLAUDE_CONFIG_DIR). Each account reads its own settings.json, so the hooks
 * the user approved for ~/.claude are mirrored into every such account, and
 * removed again when the user turns hooks off. Only ever runs after the user
 * granted hooks consent: naming an account on a Directory is the explicit act
 * that extends that consent to the account's settings file.
 */

import * as os from 'os';
import * as path from 'path';

import { getHooksConsent, getHooksEnabled } from '../configPersistence.js';
import type { HostDirectoryEntry } from '../directories.js';
import { listDirectories, normalizeDirectoryPath } from '../directories.js';
import {
  areHooksInstalled,
  forClaudeConfigDir,
  installHooks,
  uninstallHooks,
} from '../providers/hook/claude/claudeHookInstaller.js';

const PROVIDER_ID = 'claude';

/** Every account a Directory names, except the default one. */
function extraAccounts(hostDirectories: HostDirectoryEntry[]): string[] {
  const defaultDir = normalizeDirectoryPath(path.join(os.homedir(), '.claude'));
  const accounts = new Set<string>();
  for (const d of listDirectories(hostDirectories)) {
    if (d.account && normalizeDirectoryPath(d.account) !== defaultDir) accounts.add(d.account);
  }
  return [...accounts];
}

/**
 * Bring every extra account in line with the user's hooks choice: installed
 * while hooks are granted and enabled, removed otherwise (only where ours are
 * present). Never throws; failures are logged per account.
 */
export async function syncAccountHooks(
  hostDirectories: HostDirectoryEntry[],
  /** The hooks state being switched to, while it is not persisted yet. */
  enabled?: boolean,
): Promise<void> {
  const wanted =
    getHooksConsent(PROVIDER_ID) === 'granted' && (enabled ?? getHooksEnabled(PROVIDER_ID));
  for (const account of extraAccounts(hostDirectories)) {
    try {
      if (wanted) {
        await forClaudeConfigDir(account, () => installHooks());
      } else if (forClaudeConfigDir(account, () => areHooksInstalled())) {
        await forClaudeConfigDir(account, () => uninstallHooks());
      }
    } catch (err) {
      console.warn(
        `[Pixel Agents] Hooks for account ${account}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
