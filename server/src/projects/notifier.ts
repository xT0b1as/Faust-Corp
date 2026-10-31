/**
 * Phone notifications through ntfy (https://ntfy.sh or a self-hosted server):
 * a permission request anywhere, and a project lead or the secretary finishing
 * a turn. Events are bundled per window, so a burst becomes one message.
 */

import { NOTIFY_BATCH_MS } from '../constants.js';

export interface NotifierOptions {
  /** Full topic URL, e.g. https://ntfy.sh/faust-corp-<something-unguessable>. */
  url: string;
  /** Display name for an agent id (label or Directory). */
  nameOf: (id: number) => string | undefined;
  /** Whether a finished turn of this agent is worth a notification. */
  isImportant: (id: number) => boolean;
  /** Injected for tests; the global fetch otherwise. */
  post?: (url: string, body: string, headers: Record<string, string>) => Promise<unknown>;
  batchMs?: number;
}

export class Notifier {
  private lines: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: NotifierOptions) {}

  /** Feed one protocol message (node broadcast or hub-remapped). */
  apply(message: Record<string, unknown>): void {
    const id = message.id as number;
    if (typeof id !== 'number') return;
    const name = this.options.nameOf(id) ?? 'Ein Agent';
    if (message.type === 'agentToolPermission') {
      this.add(`${name} wartet auf deine Freigabe.`);
    } else if (
      message.type === 'agentStatus' &&
      message.status === 'waiting' &&
      this.options.isImportant(id)
    ) {
      this.add(`${name} ist fertig.`);
    }
  }

  private add(line: string): void {
    if (!this.lines.includes(line)) this.lines.push(line);
    this.timer ??= setTimeout(() => this.flush(), this.options.batchMs ?? NOTIFY_BATCH_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.lines.length === 0) return;
    const body = this.lines.join('\n');
    this.lines = [];
    const post =
      this.options.post ??
      ((url: string, text: string, headers: Record<string, string>) =>
        fetch(url, { method: 'POST', body: text, headers }));
    void post(this.options.url, body, { Title: 'Faust Corp', Tags: 'office' }).catch((err) =>
      console.warn(`[Pixel Agents] Notify: ${String(err)}`),
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
