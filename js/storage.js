const SETTINGS_KEY = "mrs-block-breaker-settings-v1";
const BEST_TIMES_KEY = "mrs-block-breaker-best-times-v1";

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
