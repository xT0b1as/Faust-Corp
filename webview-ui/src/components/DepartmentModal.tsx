import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';

import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export interface DepartmentValues {
  name: string;
  path: string;
  account: string;
  /** Hub mode: the machine the department lives on. */
  node?: string;
}

interface DepartmentModalProps {
  isOpen: boolean;
  /** Why the last attempt was refused, shown inline. */
  error: string | null;
  /** True while the save is on its way; the button waits. */
  pending: boolean;
  /** Hub mode: machines to choose from. Empty otherwise. */
  nodes: string[];
  onSubmit: (values: DepartmentValues) => void;
  onClose: () => void;
}

/**
 * Found a department in one step: a Directory (name, folder, account), a room
 * built onto the office with an Area of the same name, and its project lead.
 */
export function DepartmentModal({
  isOpen,
  error,
  pending,
  nodes,
  onSubmit,
  onClose,
}: DepartmentModalProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [account, setAccount] = useState('');
  const [node, setNode] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setPath('');
    setAccount('');
    setNode(nodes[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = () => {
    if (pending || !name.trim() || !path.trim()) return;
    onSubmit({
      name: name.trim(),
      path: path.trim(),
      account: account.trim(),
      ...(node ? { node } : {}),
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.stopPropagation();
      e.preventDefault();
      submit();
    }
  };

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    autoFocus = false,
  ) => (
    <label className="flex flex-col gap-2 text-xs text-text-muted">
      {label}
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => set(e.target.value)}
        className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
      />
    </label>
  );

  return (
    <Modal isOpen onClose={onClose} title="Abteilung gründen" className="min-w-[min(420px,100%)]!">
      <div
        data-testid="department-modal"
        className="flex flex-col gap-8 px-10 py-4"
        onKeyDown={handleKeyDown}
      >
        {field('Name', name, setName, 'Sport App', true)}
        {field('Ordner', path, setPath, '~/code/sport-app')}
        {nodes.length > 0 && (
          <label className="flex flex-col gap-2 text-xs text-text-muted">
            Rechner
            <select
              value={node}
              onChange={(e) => setNode(e.target.value)}
              className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
            >
              {nodes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        {field('Claude Konto (leer = Standard)', account, setAccount, '~/.claude-arbeit')}
        <p className="text-xs text-text-muted m-0">
          Baut einen Raum mit zwei Arbeitsplätzen an das Büro an und setzt Wagner als Projektleiter
          ein.
        </p>
        {error !== null && (
          <div role="alert" className="text-xs text-danger">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-8 pt-4">
          <Button variant="default" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="accent" size="sm" onClick={submit}>
            {pending ? 'Gründe...' : 'Gründen'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
