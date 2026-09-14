import { validateStage } from "./stages.js";

const SETTINGS_KEY = "mrs-block-breaker-settings-v1";
const BEST_TIMES_KEY = "mrs-block-breaker-best-times-v1";
const MAKER_LIBRARY_KEY = "mrs-block-breaker-maker-library-v1";
const MAKER_LIBRARY_VERSION = 1;
export const MAX_LOCAL_STAGES = 10;
const MAX_LOCAL_STAGE_BLOCKS = 80;

const defaultSettings = Object.freeze({ bgm: true, se: true });

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full storage quota must not stop gameplay.
  }
}

export function loadSettings() {
  const saved = readJson(SETTINGS_KEY, {});
  return {
    bgm: typeof saved.bgm === "boolean" ? saved.bgm : defaultSettings.bgm,
    se: typeof saved.se === "boolean" ? saved.se : defaultSettings.se,
  };
}

export function saveSettings(settings) {
  writeJson(SETTINGS_KEY, settings);
}

export function getBestTime(stageId) {
  const bestTimes = readJson(BEST_TIMES_KEY, {});
  const value = bestTimes[stageId];
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveBestTime(stageId, time) {
  const bestTimes = readJson(BEST_TIMES_KEY, {});
  const previous = Number.isFinite(bestTimes[stageId]) ? bestTimes[stageId] : null;
  const isBest = previous === null || time < previous;

  if (isBest) {
    bestTimes[stageId] = time;
    writeJson(BEST_TIMES_KEY, bestTimes);
  }

  return { isBest, previous, best: isBest ? time : previous };
}

function emptyMakerLibrary() {
  return { schemaVersion: MAKER_LIBRARY_VERSION, nextSequence: 1, stages: [] };
}

function normalizeStoredStage(record) {
  if (!record || record.schemaVersion !== MAKER_LIBRARY_VERSION) return null;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.title !== "string" || !record.title) return null;
  if (!record.stage || record.stage.blocks?.length > MAX_LOCAL_STAGE_BLOCKS) return null;
  const stage = { ...record.stage, id: record.id, title: record.title };
  if (!validateStage(stage)) return null;
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : 0;
  const updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
  const authorClearTime = Number.isFinite(record.authorClearTime) && record.authorClearTime > 0
    ? record.authorClearTime
    : null;
  const clearedFingerprint = typeof record.clearedFingerprint === "string"
    ? record.clearedFingerprint
    : null;
  return {
    schemaVersion: MAKER_LIBRARY_VERSION,
    id: record.id,
    title: record.title,
    stage,
    createdAt,
    updatedAt,
    authorClearTime,
    clearedFingerprint,
  };
}

function readMakerLibrary() {
  let raw;
  try {
    raw = localStorage.getItem(MAKER_LIBRARY_KEY);
  } catch {
    return { ...emptyMakerLibrary(), ok: false, error: "保存データを読み込めませんでした" };
  }
  if (!raw) return { ...emptyMakerLibrary(), ok: true, error: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...emptyMakerLibrary(), ok: false, error: "保存データが壊れています。既存データは変更していません" };
  }
  if (!parsed || parsed.schemaVersion !== MAKER_LIBRARY_VERSION || !Array.isArray(parsed.stages)) {
    return { ...emptyMakerLibrary(), ok: false, error: "未対応の保存データです。既存データは変更していません" };
  }

  const stages = parsed.stages.map(normalizeStoredStage);
  if (stages.some((stage) => !stage)) {
    return {
      schemaVersion: MAKER_LIBRARY_VERSION,
      nextSequence: Number.isInteger(parsed.nextSequence) ? parsed.nextSequence : 1,
      stages: stages.filter(Boolean),
      ok: false,
      error: "読み込めないステージがあります。既存データは変更していません",
    };
  }
  return {
    schemaVersion: MAKER_LIBRARY_VERSION,
    nextSequence: Number.isInteger(parsed.nextSequence) && parsed.nextSequence > 0 ? parsed.nextSequence : 1,
    stages,
    ok: true,
    error: null,
  };
}

function writeMakerLibrary(library) {
  try {
    localStorage.setItem(MAKER_LIBRARY_KEY, JSON.stringify({
      schemaVersion: MAKER_LIBRARY_VERSION,
      nextSequence: library.nextSequence,
      stages: library.stages,
    }));
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "保存できませんでした。空き容量やブラウザ設定を確認してください" };
  }
}

export function getMakerStageFingerprint(stage) {
  if (!stage || !Array.isArray(stage.blocks)) return "";
  const blocks = stage.blocks
    .map((entry) => [entry.x, entry.y, entry.type, entry.item || ""])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0] || String(a[2]).localeCompare(String(b[2])));
  return JSON.stringify({
    schemaVersion: stage.schemaVersion,
    grid: [stage.grid?.columns, stage.grid?.rows],
    blocks,
  });
}

export function isMakerStageCleared(record) {
  if (!record || !record.authorClearTime || !record.clearedFingerprint) return false;
  return record.clearedFingerprint === getMakerStageFingerprint(record.stage);
}

export function loadMakerLibrary() {
  const library = readMakerLibrary();
  return {
    ok: library.ok,
    error: library.error,
    nextSequence: library.nextSequence,
    stages: library.stages.slice(),
  };
}

export function getNextMakerTitle() {
  const library = readMakerLibrary();
  const sequence = library.ok ? library.nextSequence : 1;
  return "MY STAGE " + String(sequence).padStart(4, "0");
}

export function saveMakerStage(stage, { stageId = null, authorClearTime = null, clearedFingerprint = null } = {}) {
  const library = readMakerLibrary();
  if (!library.ok) return { ok: false, error: library.error, record: null };
  if (!stage || stage.blocks?.length > MAX_LOCAL_STAGE_BLOCKS) {
    return { ok: false, error: "保存できるブロックは80個までです", record: null };
  }

  const existingIndex = stageId ? library.stages.findIndex((record) => record.id === stageId) : -1;
  if (stageId && existingIndex < 0) {
    return { ok: false, error: "上書きするステージが見つかりません", record: null };
  }
  if (existingIndex < 0 && library.stages.length >= MAX_LOCAL_STAGES) {
    return { ok: false, error: "保存上限は10ステージです。不要なステージを削除してください", record: null };
  }

  const now = Date.now();
  const existing = existingIndex >= 0 ? library.stages[existingIndex] : null;
  const sequence = library.nextSequence;
  const id = existing?.id || ("maker-local-" + now.toString(36) + "-" + sequence);
  const title = existing?.title || ("MY STAGE " + String(sequence).padStart(4, "0"));
  const normalizedStage = {
    ...stage,
    id,
    title,
    subtitle: "自作ステージ",
  };
  if (!validateStage(normalizedStage)) {
    return { ok: false, error: "ステージの内容を確認してください", record: null };
  }

  const fingerprint = getMakerStageFingerprint(normalizedStage);
  const validClear = Number.isFinite(authorClearTime)
    && authorClearTime > 0
    && clearedFingerprint === fingerprint;
  const record = {
    schemaVersion: MAKER_LIBRARY_VERSION,
    id,
    title,
    stage: normalizedStage,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    authorClearTime: validClear ? authorClearTime : null,
    clearedFingerprint: validClear ? clearedFingerprint : null,
  };

  const stages = library.stages.slice();
  if (existingIndex >= 0) stages[existingIndex] = record;
  else stages.push(record);
  const nextLibrary = {
    schemaVersion: MAKER_LIBRARY_VERSION,
    nextSequence: existing ? library.nextSequence : library.nextSequence + 1,
    stages,
  };
  const writeResult = writeMakerLibrary(nextLibrary);
  return writeResult.ok ? { ok: true, error: null, record } : { ...writeResult, record: null };
}

export function deleteMakerStage(stageId) {
  const library = readMakerLibrary();
  if (!library.ok) return { ok: false, error: library.error };
  const stages = library.stages.filter((record) => record.id !== stageId);
  if (stages.length === library.stages.length) return { ok: false, error: "削除するステージが見つかりません" };
  return writeMakerLibrary({ ...library, stages });
}
