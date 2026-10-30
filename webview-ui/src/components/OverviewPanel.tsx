import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { OVERVIEW_REFRESH_MS } from '../constants.js';
import type { AccountUsage, TaskSummary } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface OverviewPanelProps {
  tasks: TaskSummary[];
  usage: AccountUsage[];
}

type Tab = 'aufgaben' | 'verbrauch';

const STATUS_ORDER = ['review', 'blockiert', 'in_arbeit', 'offen', 'erledigt'];

function needsApproval(task: TaskSummary): boolean {
  return task.approval === 'noetig';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mio`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/**
 * The office's overview: every project's tasks (with approve / reject for
 * the ones that wait on you) and today's token use per Claude account. The
 * button carries the number of open approvals, refreshed in the background.
 */
export function OverviewPanel({ tasks, usage }: OverviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('aufgaben');

  // Tasks in the background (for the badge), more often while open.
  useEffect(() => {
    transport.send({ type: 'requestTasks' });
    const timer = window.setInterval(
      () => transport.send({ type: 'requestTasks' }),
      open ? OVERVIEW_REFRESH_MS : OVERVIEW_REFRESH_MS * 4,
    );
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (open && tab === 'verbrauch') transport.send({ type: 'requestUsage' });
  }, [open, tab]);

  const pending = tasks.filter(needsApproval);
  const decide = (task: TaskSummary, approved: boolean) =>
    transport.send({
      type: 'setTaskApproval',
      directoryPath: task.directoryPath,
      file: task.file,
      approved,
    });

  const byProject = new Map<string, TaskSummary[]>();
  for (const task of [...tasks].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  )) {
    const key = task.node ? `${task.project} @${task.node}` : task.project;
    byProject.set(key, [...(byProject.get(key) ?? []), task]);
  }

  return (
    <>
      <Button
        size="sm"
        variant={pending.length > 0 ? 'accent' : 'default'}
        className="border-border! shadow-pixel"
        title="Aufgaben aller Projekte und Verbrauch"
        onClick={() => setOpen(true)}
      >
        {pending.length > 0 ? `Übersicht (${pending.length})` : 'Übersicht'}
      </Button>
      {/* Portal: the button sits in a transformed bar, which would become the
          containing block of the modal's position: fixed. */}
      {createPortal(
        <Modal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Übersicht"
          className="min-w-[min(480px,100%)]!"
        >
          <div className="flex flex-col gap-8 px-10 py-4" data-testid="overview-panel">
            <div className="flex gap-4">
              {(['aufgaben', 'verbrauch'] as const).map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={tab === t ? 'active' : 'default'}
                  onClick={() => setTab(t)}
                >
                  {t === 'aufgaben' ? 'Aufgaben' : 'Verbrauch heute'}
                </Button>
              ))}
            </div>

            {tab === 'aufgaben' && (
              <div className="flex flex-col gap-8 max-h-[60vh] overflow-y-auto pixel-scrollbar">
                {byProject.size === 0 && (
                  <span className="text-sm text-text-muted">
                    Noch keine Aufgaben. Wagner legt sie in .faust/aufgaben/ an.
                  </span>
                )}
                {[...byProject].map(([project, list]) => (
                  <div key={project} className="flex flex-col gap-2">
                    <span className="text-xs text-text-muted">{project}</span>
                    {list.map((task) => (
                      <div
                        key={`${task.directoryPath}/${task.file}`}
                        className="flex items-center gap-6 border-2 border-border px-6 py-4"
                      >
                        <span className="flex-1 min-w-0 flex flex-col">
                          <span className="text-sm overflow-hidden text-ellipsis">
                            {task.title}
                          </span>
                          <span className="text-2xs text-text-muted">
                            {task.status}
                            {task.assignee ? `, ${task.assignee}` : ''}
                            {task.approval && task.approval !== 'nicht_noetig'
                              ? `, Freigabe ${task.approval}`
                              : ''}
                          </span>
                        </span>
                        {needsApproval(task) && (
                          <span className="flex gap-4 shrink-0">
                            <Button size="sm" variant="accent" onClick={() => decide(task, true)}>
                              Freigeben
                            </Button>
                            <Button size="sm" variant="default" onClick={() => decide(task, false)}>
                              Ablehnen
                            </Button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {tab === 'verbrauch' && (
              <div className="flex flex-col gap-4">
                {usage.length === 0 && <span className="text-sm text-text-muted">Lade...</span>}
                {usage.map((u) => (
                  <div
                    key={`${u.node ?? ''}:${u.account}`}
                    className="flex flex-col border-2 border-border px-6 py-4"
                  >
                    <span className="text-sm">
                      {u.account}
                      {u.node ? ` @${u.node}` : ''}
                    </span>
                    <span className="text-2xs text-text-muted">
                      Eingabe {formatTokens(u.inputTokens)}, Ausgabe {formatTokens(u.outputTokens)},
                      aus Cache {formatTokens(u.cacheReadTokens)}, {u.sessions} Sessions
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
