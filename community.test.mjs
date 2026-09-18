import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCommunity, monthBounds, monthKey } from "./functions/api/community.js";

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

test("community lists mark only clears recorded for the signed visitor cookie", async () => {
  const secret = "test-community-signing-key";
  const id = Buffer.alloc(16).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sign = async (message) => Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))).toString("base64url");
  const cookie = `__Host-bbm-visitor=${id}.${await sign(`cookie:${id}`)}`;
  const visitorKey = await sign(`visitor:${id}`);
  const queries = [];
  const env = {
    COMMUNITY_SIGNING_KEY: secret,
    RATE_LIMIT_SALT: "other-test-secret",
    STAGES_DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async all() {
                queries.push({ sql, params });
                assert.match(sql, /LEFT JOIN stage_visitors v ON v\.stage_id = p\.id AND v\.visitor_key = \?/);
                assert.match(sql, /JOIN stage_bodies b ON b\.content_hash = p\.body_hash/);
                assert.match(sql, /p\.status = 'active'/);
                const cleared = params.includes(visitorKey) ? 1 : 0;
                return { results: [
                  { id: 1, public_id: "AAAAAAAAAAAAAAAA", created_at: "2026-09-01 00:00:00", unique_plays: 2, unique_clears: 1, viewer_cleared: cleared,
                    blocks_json: JSON.stringify([{ x: 0, y: 0, type: "normal" }, { x: 1, y: 1, type: "explosive" }, { x: 2, y: 2, type: "item", item: "life" }]) },
                  { id: 2, public_id: "BBBBBBBBBBBBBBBB", created_at: "2026-09-01 00:00:00", unique_plays: 1, unique_clears: 0, viewer_cleared: 0,
                    blocks_json: JSON.stringify([{ x: 9, y: 11, type: "solid" }]) },
                ] };
              },
            };
          },
        };
      },
    },
  };
  for (const [path, url] of [
    [["stages"], "https://example.com/api/stages"],
    [["rankings"], "https://example.com/api/rankings?kind=previous-month"],
    [["rankings"], "https://example.com/api/rankings?kind=all-time"],
  ]) {
    const response = await handleCommunity(new Request(url, { headers: { Cookie: cookie } }), env, path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const { stages } = await response.json();
    assert.deepEqual(stages.map((stage) => stage.viewerCleared), [true, false]);
    assert.equal(stages[0].preview.length, 120);
    assert.equal(stages[0].preview[0], "n");
    assert.equal(stages[0].preview[11], "e");
    assert.equal(stages[0].preview[22], "u");
    assert.equal(stages[1].preview[119], "s");
  }
  assert.equal(queries.length, 3);

  for (const headers of [{}, { Cookie: `__Host-bbm-visitor=${id}.invalid` }]) {
    const response = await handleCommunity(new Request("https://example.com/api/stages", { headers }), env, ["stages"]);
    assert.equal(response.status, 200);
    const { stages } = await response.json();
    assert.deepEqual(stages.map((stage) => stage.viewerCleared), [false, false]);
  }
  assert.equal(queries.at(-2).params[0], null);
  assert.equal(queries.at(-1).params[0], null);
});
