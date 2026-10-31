import { useEffect, useState } from 'react';

import { PLAYER_NEAR_POLL_MS } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { Button } from './ui/Button.js';

interface WalkControlsProps {
  getOfficeState: () => OfficeState;
  layoutReady: boolean;
  /** Talk to an agent: what clicking it does (select + open its terminal). */
  onTalk: (agentId: number) => void;
}

/** Keys that move your character one tile. */
const STEP_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};
const TALK_KEYS = new Set(['e', 'Enter', ' ']);

/** True while the user is typing somewhere (a field, a modal, a terminal). */
function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable)
  );
}

/**
 * Your own character: a toggle that puts you in the office, the keys that
 * move you (arrows / WASD; on a phone you tap where to go), and a "talk"
 * button whenever an agent is within reach (also E, Enter or Space).
 */
export function WalkControls({ getOfficeState, layoutReady, onTalk }: WalkControlsProps) {
  const [walking, setWalking] = useState(false);
  const [nearId, setNearId] = useState<number | null>(null);

  useEffect(() => {
    if (!layoutReady) return;
    const os = getOfficeState();
    if (walking) os.spawnPlayer();
    else os.despawnPlayer();
  }, [walking, layoutReady, getOfficeState]);

  useEffect(() => {
    if (!walking) {
      setNearId(null);
      return;
    }
    const timer = window.setInterval(
      () => setNearId(getOfficeState().agentNearPlayer()),
      PLAYER_NEAR_POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [walking, getOfficeState]);

  useEffect(() => {
    if (!walking) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = STEP_KEYS[e.key] ?? STEP_KEYS[e.key.toLowerCase()];
      if (step) {
        e.preventDefault();
        getOfficeState().playerStep(step[0], step[1]);
        return;
      }
      if (TALK_KEYS.has(e.key) || e.key.toLowerCase() === 'e') {
        const id = getOfficeState().agentNearPlayer();
        if (id !== null) {
          e.preventDefault();
          onTalk(id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [walking, getOfficeState, onTalk]);

  const nearName =
    nearId !== null
      ? (getOfficeState().agentLabels.get(nearId) ??
        getOfficeState().characters.get(nearId)?.directoryName ??
        'Agent')
      : null;

  return (
    <div className="flex gap-4">
      <Button
        size="sm"
        variant={walking ? 'active' : 'default'}
        className="border-border! shadow-pixel"
        title="Mit deiner eigenen Figur durchs Büro laufen (Pfeiltasten, WASD oder tippen)"
        onClick={() => setWalking((v) => !v)}
      >
        {walking ? 'Laufen aus' : 'Laufen'}
      </Button>
      {walking && nearId !== null && (
        <Button
          size="sm"
          variant="accent"
          className="shadow-pixel"
          title="Sprechen (E)"
          onClick={() => onTalk(nearId)}
        >
          Sprechen: {nearName}
        </Button>
      )}
    </div>
  );
}
