/**
 * Tasks as the project lead writes them: one Markdown file per task in
 * `.faust/aufgaben/`, with a small `key: value` header between `---` lines
 * (status, an, freigabe). The office reads them for its task overview and
 * writes exactly one thing back: the user's approval decision.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { HostDirectoryEntry } from '../directories.js';
import { listDirectories } from '../directories.js';
import { FAUST_DIR } from './templates.js';

const TASKS_FOLDER = 'aufgaben';
const README = 'README.md';

export interface TaskSummary {
  directoryPath: string;
  project: string;
  file: string;
  title: string;
  status: string;
  assignee?: string;
  approval?: string;
}

/** Header values, without trailing `# comments`. */
export function parseTaskHeader(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const header: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*?)\s*(#.*)?$/);
    if (match) header[match[1].toLowerCase()] = match[2];
  }
  return header;
}

function titleOf(text: string, fallback: string): string {
  const heading = text.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
  return heading ? heading.replace(/^#\s+/, '').trim() : fallback;
}

/** Every task of every known project. Unreadable files are skipped. */
export function listTasks(hostDirectories: HostDirectoryEntry[]): TaskSummary[] {
  const tasks: TaskSummary[] = [];
  for (const directory of listDirectories(hostDirectories)) {
    const folder = path.join(directory.path, FAUST_DIR, TASKS_FOLDER);
    let files: string[];
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.md') && f !== README);
    } catch {
      continue;
    }
    for (const file of files.sort()) {
      try {
        const text = fs.readFileSync(path.join(folder, file), 'utf-8');
        const header = parseTaskHeader(text);
        tasks.push({
          directoryPath: directory.path,
          project: directory.name,
          file,
          title: titleOf(text, file.replace(/\.md$/, '')),
          status: header.status || 'offen',
          ...(header.an ? { assignee: header.an } : {}),
          ...(header.freigabe ? { approval: header.freigabe } : {}),
        });
      } catch {
        // A file being written right now: it shows up on the next refresh.
      }
    }
  }
  return tasks;
}

/**
 * Record the user's decision in the task's header (`freigabe: erteilt` or
 * `abgelehnt`). Only plain file names inside the project's task folder of a
 * known Directory are accepted. Returns the task title, or an error message.
 */
export function setTaskApproval(
  hostDirectories: HostDirectoryEntry[],
  directoryPath: string,
  file: string,
  approved: boolean,
): { ok: true; title: string; project: string } | { ok: false; reason: string } {
  const directory = listDirectories(hostDirectories).find(
    (d) => path.resolve(d.path) === path.resolve(directoryPath),
  );
  if (!directory) return { ok: false, reason: 'Unbekanntes Projekt.' };
  if (path.basename(file) !== file || !file.endsWith('.md') || file === README) {
    return { ok: false, reason: 'Ungültiger Dateiname.' };
  }
  const target = path.join(directory.path, FAUST_DIR, TASKS_FOLDER, file);
  let text: string;
  try {
    text = fs.readFileSync(target, 'utf-8');
  } catch {
    return { ok: false, reason: 'Aufgabe nicht gefunden.' };
  }
  const value = approved ? 'erteilt' : 'abgelehnt';
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    const at = lines.findIndex(
      (l, i) => i > 0 && (end < 0 || i < end) && /^\s*freigabe\s*:/i.test(l),
    );
    if (at > 0) lines[at] = `freigabe: ${value}`;
    else lines.splice(end > 0 ? end : 1, 0, `freigabe: ${value}`);
  } else {
    lines.unshift('---', `freigabe: ${value}`, '---');
  }
  try {
    fs.writeFileSync(target, lines.join(eol), 'utf-8');
  } catch (err) {
    return { ok: false, reason: `Konnte nicht speichern: ${String(err)}` };
  }
  return { ok: true, title: titleOf(text, file), project: directory.name };
}
