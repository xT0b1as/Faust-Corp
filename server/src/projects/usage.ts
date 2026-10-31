/**
 * Today's token use per Claude account, read from the accounts' own session
 * transcripts (`<config dir>/projects/<project>/<session>.jsonl`). Counts every
 * assistant record dated today; only files touched today are opened.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { HostDirectoryEntry } from '../directories.js';
import { listDirectories } from '../directories.js';

export interface AccountUsage {
  /** Config directory; the default account is `~/.claude`. */
  account: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  sessions: number;
}

function isToday(date: Date, now: Date): boolean {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function accountUsage(account: string, now = new Date()): AccountUsage {
  const usage: AccountUsage = {
    account,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    sessions: 0,
  };
  const root = path.join(account, 'projects');
  let projects: string[];
  try {
    projects = fs.readdirSync(root);
  } catch {
    return usage;
  }
  for (const project of projects) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(root, project)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const full = path.join(root, project, file);
      try {
        if (!isToday(fs.statSync(full).mtime, now)) continue;
        let counted = false;
        for (const line of fs.readFileSync(full, 'utf-8').split('\n')) {
          if (!line.includes('"usage"')) continue;
          let record: {
            type?: string;
            timestamp?: string;
            message?: { usage?: Record<string, number> };
          };
          try {
            record = JSON.parse(line);
          } catch {
            continue;
          }
          const u = record.message?.usage;
          if (record.type !== 'assistant' || !u || !record.timestamp) continue;
          if (!isToday(new Date(record.timestamp), now)) continue;
          usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          usage.outputTokens += u.output_tokens ?? 0;
          usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
          counted = true;
        }
        if (counted) usage.sessions++;
      } catch {
        // A file rotating or being written: skip it this round.
      }
    }
  }
  return usage;
}

/** The default account plus every account a Directory names. */
export function usageReport(hostDirectories: HostDirectoryEntry[]): AccountUsage[] {
  const accounts = new Set<string>([path.join(os.homedir(), '.claude')]);
  for (const d of listDirectories(hostDirectories)) if (d.account) accounts.add(d.account);
  return [...accounts].map((account) => accountUsage(account));
}
