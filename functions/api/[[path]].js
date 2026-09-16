import { handleCommunity } from "./community.js";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_PUBLISHES_PER_DAY = 5;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const BLOCK_TYPES = new Set(["normal", "hit2", "hit3", "solid", "explosive", "item"]);
const ITEM_TYPES = new Set(["random", "paddle", "multiball", "largeBall", "explosiveBall", "life"]);

function json(data, { status = 200, headers = {} } = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function error(message, status, headers) {
  return json({ error: message }, { status, headers });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

async function readBoundedJson(request) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_REQUEST_BYTES) {
      throw new Response(null, { status: 413 });
    }
  }

  const encoding = request.headers.get("Content-Encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw new Response(null, { status: 415 });
  }
  if (!request.body) throw new Response(null, { status: 400 });

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Response(null, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (caught) {
    if (caught instanceof Response) throw caught;
    throw new Response(null, { status: 400 });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Response(null, { status: 400 });
  }
}

function normalizeStagePayload(payload) {
  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(["stage", "authorClearTimeMs"]))) return null;
  if (!Number.isInteger(payload.authorClearTimeMs)
    || payload.authorClearTimeMs < 100
    || payload.authorClearTimeMs > 3600000) return null;

  const stage = payload.stage;
  if (!isPlainObject(stage) || !hasOnlyKeys(stage, new Set(["schemaVersion", "grid", "blocks"]))) return null;
  if (stage.schemaVersion !== 1) return null;
  if (!isPlainObject(stage.grid)
    || !hasOnlyKeys(stage.grid, new Set(["columns", "rows"]))
    || stage.grid.columns !== 10
    || stage.grid.rows !== 12) return null;
  if (!Array.isArray(stage.blocks) || stage.blocks.length < 1 || stage.blocks.length > 80) return null;

  const occupied = new Set();
  const blocks = [];
  let hasBreakable = false;
  for (const entry of stage.blocks) {
    if (!isPlainObject(entry) || !hasOnlyKeys(entry, new Set(["x", "y", "type", "item"]))) return null;
    if (!Number.isInteger(entry.x) || entry.x < 0 || entry.x >= 10) return null;
    if (!Number.isInteger(entry.y) || entry.y < 0 || entry.y >= 12) return null;
    if (!BLOCK_TYPES.has(entry.type)) return null;
    if (entry.type === "item") {
      if (!ITEM_TYPES.has(entry.item)) return null;
    } else if (Object.prototype.hasOwnProperty.call(entry, "item")) {
      return null;
    }
    const cellKey = `${entry.x},${entry.y}`;
    if (occupied.has(cellKey)) return null;
    occupied.add(cellKey);
    if (entry.type !== "solid") hasBreakable = true;
    blocks.push({
      x: entry.x,
      y: entry.y,
      type: entry.type,
      ...(entry.type === "item" ? { item: entry.item } : {}),
    });
  }
  if (!hasBreakable) return null;

  blocks.sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type));
  return {
    authorClearTimeMs: payload.authorClearTimeMs,
    stage: {
      schemaVersion: 1,
      grid: { columns: 10, rows: 12 },
      blocks,
    },
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createPublicId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function enforceRateLimit(request, env) {
  if (!env.RATE_LIMIT_SALT) throw new Error("RATE_LIMIT_SALT is not configured");
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const windowDate = new Date().toISOString().slice(0, 10);
  const rateKey = await sha256Hex(`${env.RATE_LIMIT_SALT}:${windowDate}:${address}`);
  const row = await env.STAGES_DB.prepare(`
    INSERT INTO publish_rate_limits (rate_key, window_date, request_count, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(rate_key, window_date) DO UPDATE SET
      request_count = request_count + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING request_count
  `).bind(rateKey, windowDate).first();
  return Number(row?.request_count || 0) <= MAX_PUBLISHES_PER_DAY;
}

async function insertPublishedStage(env, normalized) {
  const blocksJson = JSON.stringify(normalized.stage.blocks);
  const canonicalBody = JSON.stringify({
    schemaVersion: normalized.stage.schemaVersion,
    grid: normalized.stage.grid,
    blocks: normalized.stage.blocks,
  });
  const bodyHash = await sha256Hex(canonicalBody);

  await env.STAGES_DB.prepare(`
    INSERT OR IGNORE INTO stage_bodies
      (content_hash, schema_version, columns_count, rows_count, blocks_json)
    VALUES (?, 1, 10, 12, ?)
  `).bind(bodyHash, blocksJson).run();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const publicId = createPublicId();
    try {
      const inserted = await env.STAGES_DB.prepare(`
        INSERT INTO published_stages (public_id, body_hash, author_clear_ms)
        VALUES (?, ?, ?)
      `).bind(publicId, bodyHash, normalized.authorClearTimeMs).run();
      const numericId = Number(inserted.meta?.last_row_id);
      if (!Number.isSafeInteger(numericId) || numericId < 1) throw new Error("D1 did not return a stage id");
      return { publicId, numericId };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.includes("UNIQUE constraint failed: published_stages.public_id")) throw caught;
    }
  }
  throw new Error("Could not allocate a unique public id");
}

async function publish(request, env) {
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin !== new URL(request.url).origin) return error("このサイトから投稿してください", 403);

  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return error("Content-Typeはapplication/jsonを指定してください", 415);

  let payload;
  try {
    payload = await readBoundedJson(request);
  } catch (caught) {
    if (caught instanceof Response && caught.status === 413) return error("投稿データが大きすぎます", 413);
    if (caught instanceof Response && caught.status === 415) return error("圧縮された投稿データには対応していません", 415);
    return error("JSON形式の投稿データを確認してください", 400);
  }

  const normalized = normalizeStagePayload(payload);
  if (!normalized) return error("ステージの内容を確認してください", 422);
  if (!await enforceRateLimit(request, env)) {
    return error("本日の投稿上限（5回）に達しました", 429, { "Retry-After": "86400" });
  }

  const inserted = await insertPublishedStage(env, normalized);
  const title = `みんなのステージ ${String(inserted.numericId).padStart(6, "0")}`;
  return json({
    publicId: inserted.publicId,
    url: `/s/${inserted.publicId}`,
    stage: { title },
  }, { status: 201 });
}

async function getPublishedStage(publicId, env) {
  if (!PUBLIC_ID_PATTERN.test(publicId)) return error("ステージが見つかりません", 404);
  const row = await env.STAGES_DB.prepare(`
    SELECT p.id, p.public_id, p.author_clear_ms, b.schema_version, b.columns_count, b.rows_count, b.blocks_json
    FROM published_stages AS p
    JOIN stage_bodies AS b ON b.content_hash = p.body_hash
    WHERE p.public_id = ? AND p.status = 'active'
    LIMIT 1
  `).bind(publicId).first();
  if (!row) return error("ステージが見つからないか、現在は公開されていません", 404);

  let blocks;
  try {
    blocks = JSON.parse(row.blocks_json);
  } catch {
    throw new Error("Stored stage body is invalid");
  }
  return json({
    stage: {
      schemaVersion: row.schema_version,
      id: `shared-${row.public_id}`,
      title: `みんなのステージ ${String(row.id).padStart(6, "0")}`,
      subtitle: "投稿ステージ",
      grid: { columns: row.columns_count, rows: row.rows_count },
      blocks,
    },
    authorClearTimeMs: row.author_clear_ms,
  });
}

export async function onRequest(context) {
  const path = Array.isArray(context.params.path)
    ? context.params.path
    : String(context.params.path || "").split("/").filter(Boolean);
  try {
    const community = await handleCommunity(context.request, context.env, path);
    if (community) return community;
    if (path.length === 1 && path[0] === "stages") {
      if (context.request.method !== "POST") return error("Method Not Allowed", 405, { "Allow": "POST" });
      return await publish(context.request, context.env);
    }
    if (path.length === 2 && path[0] === "stages") {
      if (context.request.method !== "GET") return error("Method Not Allowed", 405, { "Allow": "GET" });
      return await getPublishedStage(path[1], context.env);
    }
    return error("Not Found", 404);
  } catch (caught) {
    console.error(JSON.stringify({
      message: "Phase 4A API request failed",
      path: new URL(context.request.url).pathname,
      error: caught instanceof Error ? caught.message : String(caught),
    }));
    return error("サーバーでエラーが発生しました", 500);
  }
}

