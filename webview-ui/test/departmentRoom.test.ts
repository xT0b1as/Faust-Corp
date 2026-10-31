import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { AREA_DEFAULT_COLORS, DEPARTMENT_ROOM_WIDTH } from '../src/constants.js';
import { addDepartmentRoom } from '../src/office/layout/departmentRoom.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const [RED, , BLUE] = AREA_DEFAULT_COLORS;

/** A 6×9 office: walls round the edge, floor inside. */
function office(): OfficeLayout {
  const cols = 6;
  const rows = 9;
  const tiles = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return r === 0 || r === rows - 1 || c === 0 || c === cols - 1
      ? TileType.WALL
      : TileType.FLOOR_1;
  });
  return { version: 1, cols, rows, tiles, furniture: [] };
}

describe('addDepartmentRoom', () => {
  test('builds a walled, furnished room with a door and its own Area', () => {
    const result = addDepartmentRoom(office(), 'Research', RED);
    assert.ok(result.ok);
    const l = result.layout;
    const at = (c: number, r: number) => l.tiles[r * l.cols + c];

    // Shares the office's right wall (col 5) and adds the rest to the right.
    assert.equal(l.cols, 5 + DEPARTMENT_ROOM_WIDTH);
    assert.equal(at(l.cols - 1, 4), TileType.WALL);
    assert.equal(at(7, 0), TileType.WALL);

    // Exactly one door through the shared wall, from office floor to room floor.
    const doors = [...Array(l.rows).keys()].filter((r) => at(5, r) !== TileType.WALL);
    assert.equal(doors.length, 1);
    assert.equal(at(4, doors[0]), TileType.FLOOR_1);
    assert.equal(at(6, doors[0]), TileType.FLOOR_1);

    // Interior tiles carry the Area; the office's don't.
    assert.equal(l.areaTiles?.[2 * l.cols + 8], 'Research');
    assert.equal(l.areaTiles?.[2 * l.cols + 2], null);
    assert.deepEqual(l.areas, [{ label: 'Research', color: RED }]);

    const types = l.furniture.map((f) => f.type);
    assert.equal(types.filter((t) => t === 'DESK_FRONT').length, 2);
    assert.equal(types.filter((t) => t === 'CUSHIONED_BENCH').length, 2);
    // Everything stands inside the room.
    assert.ok(l.furniture.every((f) => f.col > 5 && f.col < l.cols - 1));
  });

  test('refuses a second Area with the same name', () => {
    const first = addDepartmentRoom(office(), 'Research', RED);
    assert.ok(first.ok);
    const second = addDepartmentRoom(first.layout, 'Research', RED);
    assert.equal(second.ok, false);
  });

  test('stacks a second department to the right of the first', () => {
    const first = addDepartmentRoom(office(), 'Research', RED);
    assert.ok(first.ok);
    const second = addDepartmentRoom(first.layout, 'Creative', BLUE);
    assert.ok(second.ok);
    assert.equal(second.layout.cols, 5 + 2 * (DEPARTMENT_ROOM_WIDTH - 1) + 1);
    assert.equal(second.layout.areas?.length, 2);
  });
});
