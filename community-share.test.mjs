import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildClearedStageShareText, shareStage } from "./js/community.js";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function useNavigator(value) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
});

test("shareStage uses Web Share API with the expected payload", async () => {
  let received = null;
  let copied = false;
  useNavigator({
    canShare: () => true,
    share: async (payload) => { received = payload; },
    clipboard: { writeText: async () => { copied = true; } },
  });
  const payload = {
    title: "ブロック崩しメーカー",
    text: "「みんなのステージ 000001」をクリア！挑戦してみて！",
    url: "https://example.com/s/AAAAAAAAAAAAAAAA",
  };
  assert.equal(await shareStage(payload), "shared");
  assert.deepEqual(received, payload);
  assert.equal(copied, false);
});

test("shareStage copies the URL when Web Share API is unavailable", async () => {
  let copied = null;
  useNavigator({ clipboard: { writeText: async (url) => { copied = url; } } });
  const url = "https://example.com/s/BBBBBBBBBBBBBBBB";
  assert.equal(await shareStage({ title: "title", text: "text", url }), "copied");
  assert.equal(copied, url);
});

test("shareStage treats share cancellation as a normal outcome", async () => {
  let copied = false;
  useNavigator({
    share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
    clipboard: { writeText: async () => { copied = true; } },
  });
  assert.equal(await shareStage({ title: "title", text: "text", url: "https://example.com" }), "cancelled");
  assert.equal(copied, false);
});

test("shareStage falls back to URL copy after a share error", async () => {
  let copied = null;
  useNavigator({
    share: async () => { throw new Error("share failed"); },
    clipboard: { writeText: async (url) => { copied = url; } },
  });
  const url = "https://example.com/s/CCCCCCCCCCCCCCCC";
  assert.equal(await shareStage({ title: "title", text: "text", url }), "copied");
  assert.equal(copied, url);
});

test("cleared-stage share text includes the displayed clear time", () => {
  assert.equal(
    buildClearedStageShareText("みんなのステージ 000001", "00:42.35"),
    "「みんなのステージ 000001」を00:42.35でクリア！挑戦してみて！",
  );
});
