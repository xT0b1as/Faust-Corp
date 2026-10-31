/**
 * "Abteilung gründen": build a furnished room for a new department onto the
 * right of the office. The room shares the office's rightmost wall, gets a
 * door through it, two desks with PCs and seats, and an Area named after the
 * department, so its agents sit there once the Directory is mapped to it.
 *
 * Pure: takes a layout, returns a new one (or a reason it does not fit).
 */

import {
  DEPARTMENT_ROOM_DESKS,
  DEPARTMENT_ROOM_MIN_HEIGHT,
  DEPARTMENT_ROOM_WIDTH,
} from '../../constants.js';
import { expandLayout } from '../editor/editorActions.js';
import type {
  ColorValue,
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeVal,
} from '../types.js';
import { TileType } from '../types.js';

export type DepartmentRoomResult =
  { ok: true; layout: OfficeLayout } | { ok: false; reason: string };

function uid(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const isFloor = (t: TileTypeVal | undefined) =>
  t !== undefined && t !== TileType.WALL && t !== TileType.VOID;

export function addDepartmentRoom(
  layout: OfficeLayout,
  label: string,
  color: string,
): DepartmentRoomResult {
  if ((layout.areas ?? []).some((a) => a.label === label)) {
    return { ok: false, reason: `Es gibt schon einen Bereich "${label}".` };
  }

  const at = (l: OfficeLayout, c: number, r: number) => l.tiles[r * l.cols + c];

  // The office's rightmost wall column becomes the new room's left wall.
  let wallCol = -1;
  for (let c = layout.cols - 1; c >= 0 && wallCol < 0; c--) {
    for (let r = 0; r < layout.rows; r++) {
      if (at(layout, c, r) === TileType.WALL) {
        wallCol = c;
        break;
      }
    }
  }
  let top = 0;
  let bottom = DEPARTMENT_ROOM_MIN_HEIGHT - 1;
  if (wallCol < 0) {
    wallCol = layout.cols;
  } else {
    const rowsAt = [...Array(layout.rows).keys()];
    top = rowsAt.find((r) => at(layout, wallCol, r) === TileType.WALL) ?? 0;
    bottom = Math.max(
      top + DEPARTMENT_ROOM_MIN_HEIGHT - 1,
      ...rowsAt.filter((r) => at(layout, wallCol, r) !== TileType.VOID),
    );
  }

  // Grow the grid until the room fits.
  let next = layout;
  while (next.cols < wallCol + DEPARTMENT_ROOM_WIDTH || next.rows <= bottom) {
    const grown = expandLayout(
      next,
      next.cols < wallCol + DEPARTMENT_ROOM_WIDTH ? 'right' : 'down',
    );
    if (!grown) return { ok: false, reason: 'Das Büro hat seine maximale Größe erreicht.' };
    next = grown.layout;
  }

  const cols = next.cols;
  const tiles = [...next.tiles];
  const tileColors = [
    ...(next.tileColors ?? new Array<ColorValue | null>(tiles.length).fill(null)),
  ];
  const areaTiles = [...(next.areaTiles ?? new Array<string | null>(tiles.length).fill(null))];
  const idx = (c: number, r: number) => r * cols + c;

  // Colours copied from the existing office, so the room matches it.
  const wallColor = tileColors[idx(wallCol, top)] ?? null;
  let floorType: TileTypeVal = TileType.FLOOR_1;
  let floorColor: ColorValue | null = null;
  for (let i = 0; i < next.tiles.length; i++) {
    if (isFloor(next.tiles[i])) {
      floorType = next.tiles[i];
      floorColor = tileColors[i] ?? null;
      break;
    }
  }

  const right = wallCol + DEPARTMENT_ROOM_WIDTH - 1;
  for (let r = top; r <= bottom; r++) {
    for (let c = wallCol; c <= right; c++) {
      const i = idx(c, r);
      const isEdge = r === top || r === bottom || c === wallCol || c === right;
      if (isEdge) {
        // Keep the shared wall as it is wherever the office already has one.
        if (c === wallCol && tiles[i] === TileType.WALL) continue;
        tiles[i] = TileType.WALL;
        tileColors[i] = wallColor;
      } else {
        tiles[i] = floorType;
        tileColors[i] = floorColor;
        areaTiles[i] = label;
      }
    }
  }

  // A door through the shared wall, as central as the office side allows.
  const middle = Math.floor((top + bottom) / 2);
  const doorRows = [...Array(bottom - top - 1).keys()]
    .map((k) => top + 1 + k)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  const door = doorRows.find((r) => wallCol > 0 && isFloor(tiles[idx(wallCol - 1, r)]));
  if (door !== undefined) {
    tiles[idx(wallCol, door)] = floorType;
    tileColors[idx(wallCol, door)] = floorColor;
  }

  const furniture: PlacedFurniture[] = [...next.furniture];
  for (let k = 0; k < DEPARTMENT_ROOM_DESKS; k++) {
    const deskCol = wallCol + 1 + k * 4;
    furniture.push({ uid: uid(), type: 'DESK_FRONT', col: deskCol, row: top + 2 });
    furniture.push({ uid: uid(), type: 'PC_FRONT_OFF', col: deskCol + 1, row: top + 2 });
    furniture.push({ uid: uid(), type: 'CUSHIONED_BENCH', col: deskCol + 1, row: top + 4 });
  }
  furniture.push({ uid: uid(), type: 'PLANT', col: right - 1, row: bottom - 2 });

  return {
    ok: true,
    layout: {
      ...next,
      tiles,
      tileColors,
      areaTiles,
      furniture,
      areas: [...(next.areas ?? []), { label, color }],
    },
  };
}
