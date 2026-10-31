/**
 * A project's memory folder: `.faust/` with its knowledge, its current state,
 * tasks, handovers and the role files, plus a block in CLAUDE.md that imports
 * them so EVERY chat in the project reads them, including ones started by hand.
 *
 * Additive only: existing files are never overwritten and CLAUDE.md is only
 * appended to, once (detected by its marker).
 */

import * as fs from 'fs';
import * as path from 'path';

import { CLAUDE_MD_MARKER, claudeMdBlock, FAUST_DIR, projectFiles } from './templates.js';

export interface ScaffoldResult {
  /** Paths (relative to the project) this call created or appended to. */
  created: string[];
}

export function ensureProjectScaffold(projectPath: string, projectName: string): ScaffoldResult {
  const created: string[] = [];

  for (const [relative, content] of Object.entries(projectFiles(projectName))) {
    const target = path.join(projectPath, FAUST_DIR, relative);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 'wx': never clobber a file that appeared between the check and the write.
    fs.writeFileSync(target, content, { encoding: 'utf-8', flag: 'wx' });
    created.push(path.join(FAUST_DIR, relative));
  }

  const claudeMd = path.join(projectPath, 'CLAUDE.md');
  const existing = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf-8') : null;
  if (existing === null) {
    fs.writeFileSync(claudeMd, claudeMdBlock(), { encoding: 'utf-8', flag: 'wx' });
    created.push('CLAUDE.md');
  } else if (!existing.includes(CLAUDE_MD_MARKER)) {
    const separator = existing.length === 0 || existing.endsWith('\n') ? '\n' : '\n\n';
    fs.appendFileSync(claudeMd, separator + claudeMdBlock(), 'utf-8');
    created.push('CLAUDE.md');
  }

  return { created };
}
