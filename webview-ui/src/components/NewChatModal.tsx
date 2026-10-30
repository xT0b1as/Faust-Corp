import type { KeyboardEvent } from 'react';
import { useEffect, useState } from 'react';

import type { Directory } from '../hooks/useExtensionMessages.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** What a launch can carry beyond its Directory: the agent's first message and
 *  its name. Both optional; an empty task is a plain launch. */
export interface LaunchTask {
  prompt?: string;
  label?: string;
}

interface NewChatModalProps {
  /** The Directory to launch into, or null when closed. */
  directory: Directory | null;
  onSubmit: (directory: Directory, task: LaunchTask) => void;
  onClose: () => void;
}

/**
 * Launch an agent with a task: a name for its character (so parallel chats in
 * one Directory stay apart) and the first message it starts working on.
 */
export function NewChatModal({ directory, onSubmit, onClose }: NewChatModalProps) {
  const [label, setLabel] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (!directory) return;
    setLabel('');
    setPrompt('');
  }, [directory]);

  if (!directory) return null;

  const submit = () => {
    onSubmit(directory, {
      label: label.trim() || undefined,
      prompt: prompt.trim() || undefined,
    });
  };

  // Scoped to the modal so the office's own Esc handling never sees it. Enter
  // submits from the name field; in the task field it stays a newline, and
  // Ctrl/Cmd+Enter submits.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter') {
      e.stopPropagation();
      const fromName = e.target instanceof HTMLInputElement;
      const fromTask = e.target instanceof HTMLTextAreaElement && (e.ctrlKey || e.metaKey);
      if (fromName || fromTask) {
        e.preventDefault();
        submit();
      }
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Neuer Chat: ${directory.name}`}
      className="min-w-[min(420px,100%)]!"
    >
      <div
        data-testid="new-chat-modal"
        className="flex flex-col gap-8 px-10 py-4"
        onKeyDown={handleKeyDown}
      >
        <label className="flex flex-col gap-2 text-xs text-text-muted">
          Name
          <input
            type="text"
            value={label}
            autoFocus
            placeholder={`${directory.name}: Login`}
            onChange={(e) => setLabel(e.target.value)}
            className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
          />
        </label>
        <label className="flex flex-col gap-2 text-xs text-text-muted">
          Auftrag
          <textarea
            value={prompt}
            rows={5}
            placeholder="Was soll dieser Chat erledigen?"
            onChange={(e) => setPrompt(e.target.value)}
            className="text-sm py-2 px-4 bg-bg border-2 border-border rounded-none text-text resize-y"
          />
        </label>
        <div className="flex items-center justify-end gap-8 pt-4">
          <Button variant="default" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="accent" size="sm" onClick={submit}>
            Starten
          </Button>
        </div>
      </div>
    </Modal>
  );
}
