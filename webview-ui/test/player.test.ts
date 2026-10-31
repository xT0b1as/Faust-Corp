import assert from 'node:assert/strict';

import { test } from 'vitest';

import { PLAYER_ID } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { MATRIX_EFFECT_DURATION, TileType } from '../src/office/types.js';

function floorLayout(cols = 9, rows = 7): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

/** Run the world long enough for any spawn effect and a few steps. */
function settle(os: OfficeState, seconds = MATRIX_EFFECT_DURATION + 2): void {
  for (let t = 0; t < seconds; t += 0.05) os.update(0.05);
}

test('your character spawns outside the agents and is drawn', () => {
  const os = new OfficeState(floorLayout());
  os.spawnPlayer();
  assert.ok(os.player);
  assert.equal(os.player.id, PLAYER_ID);
  assert.equal(os.characters.has(PLAYER_ID), false, 'never an agent: not seated, not persisted');
  assert.ok(os.getCharacters().includes(os.player));
});

test('steps one tile per key and does not wander on its own', () => {
  const os = new OfficeState(floorLayout());
  os.spawnPlayer();
  settle(os);
  const start = { col: os.player!.tileCol, row: os.player!.tileRow };
  os.playerStep(1, 0);
  settle(os);
  assert.deepEqual(
    { col: os.player!.tileCol, row: os.player!.tileRow },
    {
      col: start.col + 1,
      row: start.row,
    },
  );
  settle(os, 30);
  assert.equal(os.player!.tileCol, start.col + 1, 'stays where it was sent');
});

test('walks to a tapped tile and finds agents within talking range', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0, undefined, true);
  // Active with no seat: it works in place instead of wandering off.
  os.setAgentActive(1, true);
  const agent = os.characters.get(1)!;
  os.spawnPlayer();
  settle(os);
  assert.ok(os.playerWalkTo(agent.tileCol === 0 ? 1 : agent.tileCol - 1, agent.tileRow));
  settle(os, 10);
  assert.equal(os.agentNearPlayer(), 1);
  os.despawnPlayer();
  settle(os);
  assert.equal(os.player, null);
});

test('a meeting walks the project agents to free tiles around their lead', () => {
  const os = new OfficeState(floorLayout(9, 7));
  for (const id of [1, 2, 3]) {
    os.addAgent(id, 0, 0, undefined, true);
    os.setAgentActive(id, true);
  }
  os.gatherAround(1, [2, 3]);
  settle(os, 10);
  const lead = os.characters.get(1)!;
  const spots = [2, 3].map((id) => os.characters.get(id)!);
  for (const ch of spots) {
    assert.ok(Math.abs(ch.tileCol - lead.tileCol) + Math.abs(ch.tileRow - lead.tileRow) <= 2);
  }
  assert.notDeepEqual(
    [spots[0].tileCol, spots[0].tileRow],
    [spots[1].tileCol, spots[1].tileRow],
    'each gets its own tile',
  );
});
