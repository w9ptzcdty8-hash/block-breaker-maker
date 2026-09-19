export const STAGE_SCHEMA_VERSION = 1;
export const WARP_STAGE_SCHEMA_VERSION = 2;

export const BLOCK_TYPES = Object.freeze({
  NORMAL: "normal",
  HIT_2: "hit2",
  HIT_3: "hit3",
  SOLID: "solid",
  EXPLOSIVE: "explosive",
  ITEM: "item",
  WARP: "warp",
});

export const ITEM_TYPES = Object.freeze({
  RANDOM: "random",
  PADDLE: "paddle",
  MULTIBALL: "multiball",
  LARGE_BALL: "largeBall",
  EXPLOSIVE_BALL: "explosiveBall",
  LIFE: "life",
});

const block = (x, y, type = BLOCK_TYPES.NORMAL, item = null) => ({ x, y, type, ...(item ? { item } : {}) });
const row = (y, type = BLOCK_TYPES.NORMAL, from = 0, to = 9) => {
  const blocks = [];
  for (let x = from; x <= to; x += 1) blocks.push(block(x, y, type));
  return blocks;
};
const alternatingRow = (y, first, second) => row(y).map((entry) => ({
  ...entry,
  type: entry.x % 2 === 0 ? first : second,
}));
const compose = (...groups) => {
  const cells = new Map();
  groups.flat().forEach((entry) => cells.set(`${entry.x},${entry.y}`, entry));
  return [...cells.values()];
};

export const STAGES = [
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-01",
    title: "STAGE 01",
    subtitle: "まずは基本から",
    grid: { columns: 10, rows: 12 },
    blocks: [...row(1), ...row(2), ...row(3)],
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-02",
    title: "STAGE 02",
    subtitle: "ねらって反射",
    grid: { columns: 10, rows: 12 },
    blocks: [
      ...row(1, BLOCK_TYPES.NORMAL, 0, 3),
      ...row(1, BLOCK_TYPES.NORMAL, 6, 9),
      ...row(3, BLOCK_TYPES.NORMAL, 2, 7),
      ...row(5, BLOCK_TYPES.NORMAL, 4, 5),
    ],
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-03",
    title: "STAGE 03",
    subtitle: "2Hitブロック登場",
    grid: { columns: 10, rows: 12 },
    blocks: [...row(1, BLOCK_TYPES.HIT_2), ...row(2), ...row(3, BLOCK_TYPES.HIT_2)],
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-04",
    title: "STAGE 04",
    subtitle: "かたい3Hit",
    grid: { columns: 10, rows: 12 },
    blocks: [
      ...row(1, BLOCK_TYPES.HIT_3, 2, 7),
      ...row(2, BLOCK_TYPES.HIT_2, 1, 8),
      ...row(3),
      block(0, 4, BLOCK_TYPES.HIT_3),
      block(9, 4, BLOCK_TYPES.HIT_3),
    ],
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-05",
    title: "STAGE 05",
    subtitle: "メタルをよけろ",
    grid: { columns: 10, rows: 12 },
    blocks: [
      ...row(1),
      ...alternatingRow(2, BLOCK_TYPES.NORMAL, BLOCK_TYPES.SOLID),
      ...row(3, BLOCK_TYPES.HIT_2),
      block(2, 4, BLOCK_TYPES.SOLID),
      block(7, 4, BLOCK_TYPES.SOLID),
    ],
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-06",
    title: "STAGE 06",
    subtitle: "連鎖爆発！",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      row(1),
      row(2),
      row(3),
      block(3, 2, BLOCK_TYPES.EXPLOSIVE),
      block(4, 2, BLOCK_TYPES.EXPLOSIVE),
      block(5, 2, BLOCK_TYPES.EXPLOSIVE),
      block(6, 2, BLOCK_TYPES.EXPLOSIVE),
    ),
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-07",
    title: "STAGE 07",
    subtitle: "アイテムをキャッチ",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      row(1, BLOCK_TYPES.HIT_2),
      row(2),
      row(3),
      block(1, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.PADDLE),
      block(3, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.MULTIBALL),
      block(6, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.LARGE_BALL),
      block(8, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.EXPLOSIVE_BALL),
    ),
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-08",
    title: "STAGE 08",
    subtitle: "何が出るかな？",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      alternatingRow(1, BLOCK_TYPES.HIT_2, BLOCK_TYPES.NORMAL),
      row(2),
      alternatingRow(3, BLOCK_TYPES.NORMAL, BLOCK_TYPES.HIT_2),
      block(2, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
      block(4, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
      block(5, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
      block(7, 2, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
    ),
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-09",
    title: "STAGE 09",
    subtitle: "ミックスブロック",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      alternatingRow(1, BLOCK_TYPES.HIT_3, BLOCK_TYPES.HIT_2),
      alternatingRow(2, BLOCK_TYPES.NORMAL, BLOCK_TYPES.SOLID),
      row(3),
      block(1, 3, BLOCK_TYPES.EXPLOSIVE),
      block(4, 3, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
      block(5, 3, BLOCK_TYPES.ITEM, ITEM_TYPES.LIFE),
      block(8, 3, BLOCK_TYPES.EXPLOSIVE),
      row(5, BLOCK_TYPES.NORMAL, 2, 7),
    ),
  },
  {
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: "preset-10",
    title: "STAGE 10",
    subtitle: "全部入りチャレンジ",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      alternatingRow(0, BLOCK_TYPES.HIT_3, BLOCK_TYPES.HIT_2),
      row(1),
      alternatingRow(2, BLOCK_TYPES.SOLID, BLOCK_TYPES.NORMAL),
      row(3, BLOCK_TYPES.HIT_2),
      row(4),
      block(1, 1, BLOCK_TYPES.EXPLOSIVE),
      block(4, 1, BLOCK_TYPES.ITEM, ITEM_TYPES.RANDOM),
      block(5, 1, BLOCK_TYPES.ITEM, ITEM_TYPES.EXPLOSIVE_BALL),
      block(8, 1, BLOCK_TYPES.EXPLOSIVE),
      block(2, 4, BLOCK_TYPES.ITEM, ITEM_TYPES.MULTIBALL),
      block(7, 4, BLOCK_TYPES.ITEM, ITEM_TYPES.LIFE),
    ),
  },
  {
    schemaVersion: WARP_STAGE_SCHEMA_VERSION,
    id: "preset-11",
    title: "STAGE 11",
    subtitle: "ワープで侵入！",
    grid: { columns: 10, rows: 12 },
    blocks: compose(
      row(0, BLOCK_TYPES.SOLID, 1, 8),
      row(6, BLOCK_TYPES.SOLID, 1, 8),
      [1, 2, 3, 4, 5].flatMap((y) => [
        block(1, y, BLOCK_TYPES.SOLID),
        block(8, y, BLOCK_TYPES.SOLID),
      ]),
      row(1, BLOCK_TYPES.HIT_2, 2, 7),
      block(2, 2, BLOCK_TYPES.NORMAL),
      block(7, 2, BLOCK_TYPES.NORMAL),
      block(2, 3, BLOCK_TYPES.HIT_3),
      block(4, 3, BLOCK_TYPES.NORMAL),
      block(6, 3, BLOCK_TYPES.HIT_3),
      block(7, 4, BLOCK_TYPES.HIT_2),
      block(4, 5, BLOCK_TYPES.WARP),
      block(4, 8, BLOCK_TYPES.WARP),
    ),
  },
];

export function validateStage(stage) {
  if (!stage || ![STAGE_SCHEMA_VERSION, WARP_STAGE_SCHEMA_VERSION].includes(stage.schemaVersion)) return false;
  if (!stage.grid || stage.grid.columns !== 10 || stage.grid.rows !== 12) return false;
  if (!Array.isArray(stage.blocks) || stage.blocks.length === 0 || stage.blocks.length > 120) return false;

  const occupied = new Set();
  const validTypes = new Set(Object.values(BLOCK_TYPES));
  const validItems = new Set(Object.values(ITEM_TYPES));
  let warpCount = 0;

  for (const entry of stage.blocks) {
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) return false;
    if (entry.x < 0 || entry.x >= stage.grid.columns || entry.y < 0 || entry.y >= stage.grid.rows) return false;
    if (!validTypes.has(entry.type)) return false;
    if (entry.type === BLOCK_TYPES.ITEM && !validItems.has(entry.item)) return false;
    if (entry.type === BLOCK_TYPES.WARP) warpCount += 1;
    const key = `${entry.x},${entry.y}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
  }

  if (stage.schemaVersion === STAGE_SCHEMA_VERSION && warpCount > 0) return false;
  if (stage.schemaVersion === WARP_STAGE_SCHEMA_VERSION && warpCount !== 2) return false;

  return stage.blocks.some((entry) => ![BLOCK_TYPES.SOLID, BLOCK_TYPES.WARP].includes(entry.type));
}
