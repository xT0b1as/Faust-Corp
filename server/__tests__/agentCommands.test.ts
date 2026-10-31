import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentState } from '../src/agentState.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { AGENT_COMMAND_CLEAR_SETTLE_MS, AGENT_COMMAND_SUBMIT_DELAY_MS } from '../src/constants.js';
import { runAgentCommand } from '../src/projects/agentCommands.js';
import type { IPty, PtyModule } from '../src/terminal/ptyModule.js';
import { PtySessionManager } from '../src/terminal/ptySessionManager.js';

class RecordingPty implements IPty {
  readonly pid = 1;
  writes: string[] = [];
  onData(): void {}
  onExit(): void {}
  write(data: string): void {
    this.writes.push(data);
  }
  resize(): void {}
  kill(): void {}
}

describe('runAgentCommand', () => {
  let store: AgentStateStore;
  let ptyManager: PtySessionManager;
  let pty: RecordingPty;

  function addAgent(id: number, projectRole?: 'lead'): void {
    store.set(
      id,
      createAgentState({
        id,
        sessionId: `s${id}`,
        projectDir: '/p',
        jsonlFile: '/p/x.jsonl',
        isExternal: false,
        projectRole,
      }),
    );
    ptyManager.create({ agentId: id, command: 'claude', args: [], cwd: '/' });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    store = new AgentStateStore();
    pty = new RecordingPty();
    const module: PtyModule = { spawn: () => pty };
    ptyManager = new PtySessionManager(() => ({ module, moduleId: 'fake', reason: null }));
  });

  afterEach(() => {
    vi.useRealTimers();
    store.dispose();
  });

  it('types /compact, then Enter after a pause', async () => {
    addAgent(1);
    expect(runAgentCommand({ store, ptyManager }, 1, 'compact')).toBeNull();
    expect(pty.writes).toEqual(['/compact']);
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_SUBMIT_DELAY_MS);
    expect(pty.writes).toEqual(['/compact', '\r']);
  });

  it('restarts with a handover: handover, wait for the turn, /clear, resume', async () => {
    addAgent(1, 'lead');
    runAgentCommand({ store, ptyManager }, 1, 'restartWithHandover');
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_SUBMIT_DELAY_MS);
    expect(pty.writes[0]).toContain('.faust/uebergaben/');
    expect(pty.writes).toHaveLength(2);

    // Nothing more until the agent has finished writing its handover.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pty.writes).toHaveLength(2);

    store.broadcast({ type: 'agentStatus', id: 1, status: 'waiting' });
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_SUBMIT_DELAY_MS);
    expect(pty.writes.slice(2)).toEqual(['/clear', '\r']);

    await vi.advanceTimersByTimeAsync(
      AGENT_COMMAND_CLEAR_SETTLE_MS + AGENT_COMMAND_SUBMIT_DELAY_MS,
    );
    // The lead gets its role back along with the handover.
    expect(pty.writes[4]).toContain('projektleiter.md');
    expect(pty.writes[4]).toContain('Übergabe');
    expect(pty.writes[5]).toBe('\r');
  });

  it('asks only a lead to hold a meeting', async () => {
    addAgent(1, 'lead');
    expect(runAgentCommand({ store, ptyManager }, 1, 'meeting')).toBeNull();
    await vi.advanceTimersByTimeAsync(AGENT_COMMAND_SUBMIT_DELAY_MS);
    expect(pty.writes[0]).toContain('chats_auflisten');
    expect(pty.writes[1]).toBe('\r');
    addAgent(2);
    expect(runAgentCommand({ store, ptyManager }, 2, 'meeting')).not.toBeNull();
  });

  it('refuses an agent without a terminal and one that is mid-tool', () => {
    expect(runAgentCommand({ store, ptyManager }, 9, 'compact')).not.toBeNull();
    addAgent(2);
    store.get(2)!.activeToolIds.add('t1');
    expect(runAgentCommand({ store, ptyManager }, 2, 'compact')).not.toBeNull();
  });
});
