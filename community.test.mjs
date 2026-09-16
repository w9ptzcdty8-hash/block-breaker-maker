import assert from "node:assert/strict";
import { test } from "node:test";
import { monthBounds, monthKey } from "./functions/api/community.js";

test("JST midnight starts a new month, including the year boundary", () => {
  assert.equal(monthKey(new Date("2026-08-31T14:59:59Z")), "2026-08");
  assert.equal(monthKey(new Date("2026-08-31T15:00:00Z")), "2026-09");
  assert.equal(monthKey(new Date("2026-12-31T14:59:59Z")), "2026-12");
  assert.equal(monthKey(new Date("2026-12-31T15:00:00Z")), "2027-01");
});

test("JST month SQL boundaries handle February and leap years", () => {
  assert.deepEqual(monthBounds("2024-02"), ["2024-01-31 15:00:00", "2024-02-29 15:00:00"]);
  assert.deepEqual(monthBounds("2026-09"), ["2026-08-31 15:00:00", "2026-09-30 15:00:00"]);
  assert.throws(() => monthBounds("2026-13"));
});

