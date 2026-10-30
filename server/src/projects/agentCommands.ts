/**
 * Commands the office types into an agent's terminal on the user's behalf:
 * compact the context, or restart the session with a handover (the agent
 * writes down where it stands, the session is cleared, the fresh session reads
 * the handover back). Only PTY agents qualify: an adopted agent has no
 * terminal we could type into.
 */

import type { AgentStateStore } from '../agentStateStore.js';
import {
  AGENT_COMMAND_CLEAR_SETTLE_MS,
  AGENT_COMMAND_HANDOVER_TIMEOUT_MS,
  AGENT_COMMAND_SUBMIT_DELAY_MS,
} from '../constants.js';
import type { PtySessionManager } from '../terminal/ptySessionManager.js';
import { FAUST_DIR, leadPrompt } from './templates.js';

export type AgentCommand = 'compact' | 'restartWithHandover';

export interface AgentCommandDeps {
  store: AgentStateStore;
  ptyManager: PtySessionManager;
}

/** Agents with a command still in flight; a second press is ignored. */
const busy = new Set<number>();

const HANDOVER_PROMPT =
  `Du wirst gleich neu gestartet, um Kontext freizumachen. Schreibe jetzt eine Übergabe ` +
  `nach ${FAUST_DIR}/uebergaben/ (Dateiname JJJJ-MM-TT-HHMM-<dein name>.md): was erledigt ist, ` +
  `was offen ist, was der nächste Chat wissen muss. Bist du der Projektleiter, aktualisiere ` +
  `zusätzlich ${FAUST_DIR}/stand.md. Antworte danach nur mit: Übergabe fertig.`;

const RESUME_PROMPT =
  `Du wurdest neu gestartet. Lies die neueste Übergabe in ${FAUST_DIR}/uebergaben/ ` +
  `und mache dort weiter.`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Type a line and press Enter, apart, so the TUI doesn't treat it as a paste. */
async function submit(ptyManager: PtySessionManager, id: number, text: string): Promise<void> {
  const session = ptyManager.get(id);
  if (!session) throw new Error('terminal closed');
  session.write(text);
  await sleep(AGENT_COMMAND_SUBMIT_DELAY_MS);
  ptyManager.get(id)?.write('\r');
}

/** Resolves when the agent finishes its turn (agentStatus: waiting). */
function waitForTurnEnd(store: AgentStateStore, id: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      store.off('broadcast', onBroadcast);
      reject(new Error('timed out waiting for the handover'));
    }, timeoutMs);
    function onBroadcast(message: Record<string, unknown>): void {
      if (message.type === 'agentClosed' && message.id === id) {
        clearTimeout(timer);
        store.off('broadcast', onBroadcast);
        reject(new Error('agent closed'));
      } else if (
        message.type === 'agentStatus' &&
        message.id === id &&
        message.status === 'waiting'
      ) {
        clearTimeout(timer);
        store.off('broadcast', onBroadcast);
        resolve();
      }
    }
    store.on('broadcast', onBroadcast);
  });
}

/**
 * Run a command. Returns an error message when it cannot start; the restart
 * itself runs on in the background and logs its outcome.
 */
export function runAgentCommand(
  deps: AgentCommandDeps,
  id: number,
  command: AgentCommand,
): string | null {
  const agent = deps.store.get(id);
  if (!agent || !deps.ptyManager.has(id)) {
    return 'Dieser Agent hat kein Terminal im Büro.';
  }
  if (busy.has(id)) return null;
  if (agent.activeToolIds.size > 0) {
    return 'Der Agent arbeitet gerade. Warte, bis er fertig ist.';
  }

  if (command === 'compact') {
    busy.add(id);
    void submit(deps.ptyManager, id, '/compact')
      .catch((err) => console.warn(`[Pixel Agents] Agent ${id}: compact failed: ${String(err)}`))
      .finally(() => busy.delete(id));
    return null;
  }

  busy.add(id);
  const isLead = agent.projectRole === 'lead';
  void (async () => {
    try {
      const turnEnd = waitForTurnEnd(deps.store, id, AGENT_COMMAND_HANDOVER_TIMEOUT_MS);
      await submit(deps.ptyManager, id, HANDOVER_PROMPT);
      await turnEnd;
      await submit(deps.ptyManager, id, '/clear');
      await sleep(AGENT_COMMAND_CLEAR_SETTLE_MS);
      await submit(
        deps.ptyManager,
        id,
        isLead ? `${leadPrompt()} ${RESUME_PROMPT}` : RESUME_PROMPT,
      );
      console.log(`[Pixel Agents] Agent ${id}: restarted with handover`);
    } catch (err) {
      console.warn(`[Pixel Agents] Agent ${id}: restart with handover stopped: ${String(err)}`);
    } finally {
      busy.delete(id);
    }
  })();
  return null;
}
