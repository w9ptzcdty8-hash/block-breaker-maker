const ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const COOKIE_NAME = "__Host-bbm-visitor";
const encoder = new TextEncoder();
const PLAY_TTL_MS = 60 * 60 * 1000;

function reply(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function fail(message, status, headers = {}) { return reply({ error: message }, status, headers); }
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function decode64(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > 2048) throw new Error("Invalid encoding");
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function randomId() { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return base64url(bytes); }
async function key(env) {
  if (!env.COMMUNITY_SIGNING_KEY || env.COMMUNITY_SIGNING_KEY === env.RATE_LIMIT_SALT) throw new Error("Separate community signing key required");
  return crypto.subtle.importKey("raw", encoder.encode(env.COMMUNITY_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function sign(secretKey, text) { return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", secretKey, encoder.encode(text)))); }
async function matches(secretKey, text, signature) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const actual = await sign(secretKey, text);
  let difference = 0;
  for (let i = 0; i < actual.length; i += 1) difference |= actual.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}

export function monthKey(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, number] = month.split("-").map(Number);
  const begin = new Date(Date.UTC(year, number - 1, 1) - 9 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, number, 1) - 9 * 60 * 60 * 1000);
  const sql = (date) => date.toISOString().slice(0, 19).replace("T", " ");
  return [sql(begin), sql(end)];
}
function previousMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}
async function visitor(request, secretKey, create = false) {
  const raw = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const parts = raw?.split(".");
  if (parts?.length === 2 && /^[A-Za-z0-9_-]{22}$/.test(parts[0]) && await matches(secretKey, `cookie:${parts[0]}`, parts[1])) {
    return { id: parts[0], header: null };
  }
  if (!create) return null;
  const id = randomId();
  return { id, header: `${COOKIE_NAME}=${id}.${await sign(secretKey, `cookie:${id}`)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` };
}
async function visitorKey(secretKey, id) { return sign(secretKey, `visitor:${id}`); }
async function currentVisitorKey(request, env) {
  if (!request.headers.get("Cookie")?.includes(`${COOKIE_NAME}=`)) return null;
  const secretKey = await key(env);
  const device = await visitor(request, secretKey);
  return device ? visitorKey(secretKey, device.id) : null;
}
async function limitRequest(request, env) {
  if (!env.RATE_LIMIT_SALT) throw new Error("RATE_LIMIT_SALT required");
  const minute = new Date().toISOString().slice(0, 16);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${env.RATE_LIMIT_SALT}:community:${minute}:${ip}`));
  const rateKey = base64url(new Uint8Array(digest));
  const current = await env.STAGES_DB.prepare("SELECT request_count FROM community_rate_limits WHERE rate_key = ? AND window_minute = ?")
    .bind(rateKey, minute).first();
  // Rejected requests do not write again; the threshold is deliberately below the D1 daily write allowance.
  if (Number(current?.request_count || 0) >= 30) return false;
  const row = await env.STAGES_DB.prepare(`INSERT INTO community_rate_limits(rate_key, window_minute, request_count) VALUES (?, ?, 1)
    ON CONFLICT(rate_key, window_minute) DO UPDATE SET request_count = request_count + 1 RETURNING request_count`)
    .bind(rateKey, minute).first();
  return Number(row?.request_count || 0) <= 30;
}
async function stageId(publicId, env) {
  if (!ID_PATTERN.test(publicId)) return null;
  return env.STAGES_DB.prepare("SELECT id FROM published_stages WHERE public_id = ? AND status = 'active'").bind(publicId).first();
}
async function body(request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return fail("同一サイトから操作してください", 403);
  if (request.headers.get("Content-Type")?.split(";", 1)[0].toLowerCase() !== "application/json") return fail("JSONを指定してください", 415);
  const length = request.headers.get("Content-Length");
  if (length !== null && (!Number.isInteger(Number(length)) || Number(length) > 2048 || Number(length) < 0)) return fail("データが大きすぎます", 413);
  if (request.headers.get("Content-Encoding") && request.headers.get("Content-Encoding").toLowerCase() !== "identity") return fail("圧縮には対応していません", 415);
  if (!request.body) return fail("JSONを指定してください", 400);
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) { await reader.cancel(); return fail("データが大きすぎます", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { return fail("JSONを確認してください", 400); }
}
async function token(secretKey, stage, id, issuedAt, month) {
  const payload = base64url(encoder.encode(JSON.stringify({ stage, issuedAt, month, nonce: randomId() })));
  return `${payload}.${await sign(secretKey, `play:${id}:${payload}`)}`;
}
async function verifyToken(secretKey, value, stage, id) {
  if (typeof value !== "string" || value.length > 512) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !await matches(secretKey, `play:${id}:${payload}`, signature)) return null;
  try {
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode64(payload)));
    if (data.stage !== stage || !Number.isSafeInteger(data.issuedAt)
      || Date.now() < data.issuedAt - 60000 || Date.now() - data.issuedAt > PLAY_TTL_MS
      || !/^[A-Za-z0-9_-]{22}$/.test(data.nonce) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)) return null;
    return data;
  } catch { return null; }
}
async function play(request, env, publicId) {
  const input = await body(request);
  if (input instanceof Response) return input;
  if (Object.keys(input).length) return fail("リクエストを確認してください", 422);
  const record = await stageId(publicId, env);
  if (!record) return fail("ステージが見つかりません", 404);
  if (!await limitRequest(request, env)) return fail("アクセスが集中しています", 429, { "Retry-After": "60" });
  const secretKey = await key(env);
  const device = await visitor(request, secretKey, true);
  const unique = await visitorKey(secretKey, device.id);
  const month = monthKey();
  await env.STAGES_DB.batch([
    env.STAGES_DB.prepare("INSERT OR IGNORE INTO stage_visitors(stage_id, visitor_key) VALUES (?, ?)").bind(record.id, unique),
    env.STAGES_DB.prepare("INSERT OR IGNORE INTO stage_month_visitors(stage_id, month_key, visitor_key) VALUES (?, ?, ?)").bind(record.id, month, unique),
  ]);
  const playId = await token(secretKey, publicId, device.id, Date.now(), month);
  return reply({ playId }, 201, device.header ? { "Set-Cookie": device.header } : {});
}
async function clear(request, env, publicId) {
  const input = await body(request);
  if (input instanceof Response) return input;
  if (Object.keys(input).length !== 1 || typeof input.playId !== "string") return fail("プレイIDを確認してください", 422);
  const record = await stageId(publicId, env);
  if (!record) return fail("ステージが見つかりません", 404);
  if (!await limitRequest(request, env)) return fail("アクセスが集中しています", 429, { "Retry-After": "60" });
  const secretKey = await key(env);
  const device = await visitor(request, secretKey);
  if (!device) return fail("端末IDを確認してください", 400);
  const verified = await verifyToken(secretKey, input.playId, publicId, device.id);
  if (!verified) return fail("プレイIDが無効または期限切れです", 400);
  const unique = await visitorKey(secretKey, device.id);
  await env.STAGES_DB.batch([
    env.STAGES_DB.prepare("UPDATE stage_visitors SET first_clear_at = CURRENT_TIMESTAMP WHERE stage_id = ? AND visitor_key = ? AND first_clear_at IS NULL").bind(record.id, unique),
    env.STAGES_DB.prepare("UPDATE stage_month_visitors SET first_clear_at = CURRENT_TIMESTAMP WHERE stage_id = ? AND month_key = ? AND visitor_key = ? AND first_clear_at IS NULL").bind(record.id, verified.month, unique),
  ]);
  return reply({ recorded: true });
}
function tuple(row) { return { at: row.created_at, id: row.id }; }
function encodeCursor(value) { return base64url(encoder.encode(JSON.stringify(value))); }
function parseCursor(raw, month) {
  if (!raw) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(decode64(raw)));
    const valid = (item) => item && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(item.at) && Number.isSafeInteger(item.id) && item.id > 0;
    if (data.month === month && valid(data.anchor) && valid(data.last)
      && (data.last.at < data.anchor.at || data.last.at === data.anchor.at && data.last.id <= data.anchor.id)) return data;
  } catch { /* malformed cursor */ }
  return false;
}
const PREVIEW_BLOCK_CODES = Object.freeze({
  normal: "n",
  hit2: "2",
  hit3: "3",
  solid: "s",
  explosive: "e",
});
const PREVIEW_ITEM_CODES = Object.freeze({
  random: "r",
  paddle: "p",
  multiball: "m",
  largeBall: "l",
  explosiveBall: "b",
  life: "u",
});
function stagePreview(blocksJson) {
  try {
    const blocks = JSON.parse(blocksJson);
    if (!Array.isArray(blocks)) return null;
    const cells = Array(120).fill(".");
    for (const block of blocks) {
      if (!Number.isInteger(block?.x) || block.x < 0 || block.x >= 10
        || !Number.isInteger(block?.y) || block.y < 0 || block.y >= 12) return null;
      const code = block.type === "item" ? PREVIEW_ITEM_CODES[block.item] : PREVIEW_BLOCK_CODES[block.type];
      const index = block.y * 10 + block.x;
      if (!code || cells[index] !== ".") return null;
      cells[index] = code;
    }
    return cells.join("");
  } catch {
    return null;
  }
}
function stageSummary(row) {
  const plays = Number(row.unique_plays || 0);
  const clears = Number(row.unique_clears || 0);
  return { publicId: row.public_id, title: `みんなのステージ ${String(row.id).padStart(6, "0")}`,
    createdAt: row.created_at, uniquePlays: plays, uniqueClears: clears,
    clearRate: plays ? Math.round(clears / plays * 1000) / 10 : null,
    viewerCleared: row.viewer_cleared === 1,
    preview: stagePreview(row.blocks_json) };
}
async function list(request, env) {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((name) => name !== "cursor")) return fail("クエリを確認してください", 400);
  const month = monthKey();
  const cursor = parseCursor(url.searchParams.get("cursor"), month);
  if (cursor === false) return fail("カーソルを確認してください", 400);
  const [begin, end] = monthBounds(month);
  const viewerKey = await currentVisitorKey(request, env);
  const where = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id <= ?)) AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
  const args = cursor ? [cursor.anchor.at, cursor.anchor.at, cursor.anchor.id, cursor.last.at, cursor.last.at, cursor.last.id] : [];
  const result = await env.STAGES_DB.prepare(`SELECT p.id, p.public_id, p.created_at, s.unique_plays, s.unique_clears, b.blocks_json,
      (v.first_clear_at IS NOT NULL) AS viewer_cleared
    FROM published_stages p LEFT JOIN stage_stats s ON s.stage_id = p.id
    JOIN stage_bodies b ON b.content_hash = p.body_hash
    LEFT JOIN stage_visitors v ON v.stage_id = p.id AND v.visitor_key = ?
    WHERE p.status = 'active' AND p.created_at >= ? AND p.created_at < ? ${where}
    ORDER BY p.created_at DESC, p.id DESC LIMIT 21`).bind(viewerKey, begin, end, ...args).all();
  const rows = result.results || [];
  const shown = rows.slice(0, 20);
  const anchor = cursor?.anchor || (shown.length ? tuple(shown[0]) : null);
  const nextCursor = rows.length > 20 ? encodeCursor({ month, anchor, last: tuple(shown[shown.length - 1]) }) : null;
  return reply({ month, stages: shown.map(stageSummary), nextCursor });
}
async function ranking(request, env) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if ((kind !== "previous-month" && kind !== "all-time") || [...url.searchParams.keys()].some((name) => name !== "kind")) return fail("ランキング種別を確認してください", 400);
  const viewerKey = await currentVisitorKey(request, env);
  let result, label;
  if (kind === "previous-month") {
    label = previousMonth(monthKey());
    const [begin, end] = monthBounds(label);
    result = await env.STAGES_DB.prepare(`SELECT p.id, p.public_id, p.created_at, s.unique_plays, s.unique_clears, b.blocks_json,
        (v.first_clear_at IS NOT NULL) AS viewer_cleared
      FROM published_stages p LEFT JOIN stage_month_stats s ON s.stage_id = p.id AND s.month_key = ?
      JOIN stage_bodies b ON b.content_hash = p.body_hash
      LEFT JOIN stage_visitors v ON v.stage_id = p.id AND v.visitor_key = ?
      WHERE p.status = 'active' AND p.created_at >= ? AND p.created_at < ?
      ORDER BY COALESCE(s.unique_plays,0) DESC, COALESCE(s.unique_clears,0) DESC, p.created_at ASC, p.id ASC LIMIT 30`)
      .bind(label, viewerKey, begin, end).all();
  } else {
    label = "all-time";
    result = await env.STAGES_DB.prepare(`SELECT p.id, p.public_id, p.created_at, s.unique_plays, s.unique_clears, b.blocks_json,
        (v.first_clear_at IS NOT NULL) AS viewer_cleared
      FROM published_stages p LEFT JOIN stage_stats s ON s.stage_id = p.id
      JOIN stage_bodies b ON b.content_hash = p.body_hash
      LEFT JOIN stage_visitors v ON v.stage_id = p.id AND v.visitor_key = ?
      WHERE p.status = 'active'
      ORDER BY COALESCE(s.unique_plays,0) DESC, COALESCE(s.unique_clears,0) DESC, p.created_at ASC, p.id ASC LIMIT 10`).bind(viewerKey).all();
  }
  return reply({ period: label, stages: (result.results || []).map(stageSummary) });
}
export async function handleCommunity(request, env, path) {
  try {
    if (path.length === 1 && path[0] === "stages" && request.method === "GET") return await list(request, env);
    if (path.length === 1 && path[0] === "rankings" && request.method === "GET") return await ranking(request, env);
    if (path.length === 3 && path[0] === "stages" && ["plays", "clears"].includes(path[2])) {
      if (request.method !== "POST") return fail("Method Not Allowed", 405, { Allow: "POST" });
      return path[2] === "plays" ? await play(request, env, path[1]) : await clear(request, env, path[1]);
    }
    return null;
  } catch (caught) {
    console.error("Community API failed", caught instanceof Error ? caught.message : String(caught));
    return fail("集計サービスを利用できません", 503, { "Retry-After": "60" });
  }
}
