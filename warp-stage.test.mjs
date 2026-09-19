import assert from "node:assert/strict";
import { test } from "node:test";
import { BlockBreakerGame } from "./js/game.js";
import {
  BLOCK_TYPES,
  STAGES,
  STAGE_SCHEMA_VERSION,
  WARP_STAGE_SCHEMA_VERSION,
  validateStage,
} from "./js/stages.js";

const canvas = { getContext: () => null };

test("existing schema stays valid while warp requires schema version 2 and one pair", () => {
  assert.equal(validateStage(STAGES[0]), true);
  assert.equal(STAGES[0].schemaVersion, STAGE_SCHEMA_VERSION);

  const warpStage = STAGES.find((stage) => stage.id === "preset-11");
  assert.ok(warpStage);
  assert.equal(warpStage.schemaVersion, WARP_STAGE_SCHEMA_VERSION);
  assert.equal(warpStage.blocks.filter((entry) => entry.type === BLOCK_TYPES.WARP).length, 2);
  assert.equal(validateStage(warpStage), true);

  const solidCells = new Set(warpStage.blocks
    .filter((entry) => entry.type === BLOCK_TYPES.SOLID)
    .map((entry) => `${entry.x},${entry.y}`));
  const enclosure = [
    ...Array.from({ length: 8 }, (_, index) => `${index + 1},0`),
    ...Array.from({ length: 8 }, (_, index) => `${index + 1},6`),
    ...[1, 2, 3, 4, 5].flatMap((y) => [`1,${y}`, `8,${y}`]),
  ];
  enclosure.forEach((cell) => assert.equal(solidCells.has(cell), true, `${cell} must close the warp room`));
  [7, 8, 9].flatMap((y) => [`3,${y}`, `5,${y}`])
    .forEach((cell) => assert.equal(solidCells.has(cell), false, `${cell} must stay open around the entrance`));

  assert.equal(validateStage({
    ...warpStage,
    schemaVersion: STAGE_SCHEMA_VERSION,
  }), false);
  assert.equal(validateStage({
    ...warpStage,
    blocks: warpStage.blocks.filter((entry, index) => entry.type !== BLOCK_TYPES.WARP || index === 0),
  }), false);
});

test("warp preserves velocity and prevents an immediate second warp", () => {
  const game = new BlockBreakerGame(canvas);
  const stage = STAGES.find((entry) => entry.id === "preset-11");
  game.blocks = game.createBlocks(stage);
  const [source, destination] = game.blocks.filter((entry) => entry.type === BLOCK_TYPES.WARP);
  const ball = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
    vx: 120,
    vy: -240,
    radius: 6,
    warpCooldown: 0,
    smashContacts: new Set([source]),
    trail: [{ x: 1, y: 1, radius: 6 }],
  };

  assert.equal(game.tryWarpBall(ball), true);
  assert.equal(ball.vx, 120);
  assert.equal(ball.vy, -240);
  assert.ok(ball.warpCooldown >= 3);
  assert.equal(ball.smashContacts.size, 0);
  assert.deepEqual(ball.trail, []);
  assert.ok(Math.hypot(
    ball.x - (destination.x + destination.width / 2),
    ball.y - (destination.y + destination.height / 2),
  ) > ball.radius);
  assert.equal(game.tryWarpBall(ball), false);
  assert.equal(game.getWarpBlinkOpacity({ warpCooldown: 3 }), 0.25);
  assert.equal(game.getWarpBlinkOpacity({ warpCooldown: 2.9 }), 1);
  assert.equal(game.getWarpBlinkOpacity({ warpCooldown: 0 }), 1);
});

test("warp is indestructible and does not prevent stage clear", () => {
  let cleared = false;
  const game = new BlockBreakerGame(canvas, { onClear: () => { cleared = true; } });
  const stage = STAGES.find((entry) => entry.id === "preset-11");
  game.blocks = game.createBlocks(stage);
  const warp = game.blocks.find((entry) => entry.type === BLOCK_TYPES.WARP);
  assert.equal(game.damageBlock(warp, 99, "smash"), false);
  assert.equal(warp.active, true);

  game.blocks.forEach((entry) => {
    if (![BLOCK_TYPES.SOLID, BLOCK_TYPES.WARP].includes(entry.type)) entry.active = false;
  });
  game.state = "running";
  game.pendingExplosions = [];
  game.checkForStageClear();
  assert.equal(game.state, "cleared");
  assert.equal(cleared, true);
});
