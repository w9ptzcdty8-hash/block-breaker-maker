import { AudioManager } from "./audio.js";
import { beginSharedPlay, copyShareUrl, fetchCommunityList, fetchCommunityRanking, fetchSharedStage, getSharedStageId, publishStage, reportSharedClear, shareStage } from "./community.js";
import { BlockBreakerGame } from "./game.js";
import { StageMaker } from "./maker.js";
import { STAGES } from "./stages.js";
import { drawStagePreview } from "./stage-preview.js";
import {
  deleteMakerStage,
  getBestTime,
  getMakerStageFingerprint,
  getNextMakerTitle,
  isMakerStageCleared,
  loadMakerLibrary,
  loadSettings,
  MAX_LOCAL_STAGES,
  saveBestTime,
  saveMakerStage,
  saveSettings,
} from "./storage.js";

const screens = [...document.querySelectorAll(".screen")];
const canvas = document.querySelector("#game-canvas");
const gameScreen = document.querySelector("#screen-game");
const gameWrap = document.querySelector("#game-wrap");
const launchGuide = document.querySelector("#launch-guide");
const effectBar = document.querySelector("#effect-bar");
const pauseModal = document.querySelector("#modal-pause");
const settingsModal = document.querySelector("#modal-settings");
const timeElement = document.querySelector("#game-time");
const livesElement = document.querySelector("#game-lives");
const stageNameElement = document.querySelector("#game-stage-name");
const smashGauge = document.querySelector("#smash-gauge");
const smashGaugeFill = document.querySelector("#smash-gauge-fill");
const smashGaugeLabel = document.querySelector("#smash-gauge-label");
const publishButton = document.querySelector("#btn-maker-publish");
const settings = loadSettings();
const audio = new AudioManager(settings);

let currentStage = STAGES[0];
let activePointer = null;
let makerTestActive = false;
let sharedStageActive = false;
let currentMakerRecord = null;
let draftClear = null;
let makerTestFingerprint = "";
let publishing = false;
let sharedPlayAttempt = null;
let communityKind = "current";
let communityCursor = null;
let communityLoading = false;
let communityGeneration = 0;

function formatTime(seconds) {
  const totalHundredths = Math.max(0, Math.floor(seconds * 100));
  const minutes = Math.floor(totalHundredths / 6000);
  const wholeSeconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function showScreen(id) {
  screens.forEach((screen) => screen.classList.toggle("hidden", screen.id !== id));
}

function updateSoundButton(button, enabled) {
  button.classList.toggle("off", !enabled);
  button.querySelector("strong").textContent = enabled ? "ON" : "OFF";
}

function renderEffects(effects) {
  effectBar.replaceChildren(...effects.map((effect) => {
    const chip = document.createElement("span");
    chip.className = "effect-chip";
    chip.textContent = `${effect.label} ${Math.ceil(effect.remaining)}s`;
    return chip;
  }));
}

function renderSmashGauge({ ratio, active, ready, remaining }) {
  const percent = Math.round(ratio * 100);
  smashGaugeFill.style.transform = `scaleX(${ratio})`;
  smashGauge.classList.toggle("active", active);
  smashGauge.classList.toggle("ready", ready && !active);
  smashGauge.classList.toggle("ending", active && remaining <= 3);
  smashGaugeLabel.textContent = active
    ? `SMASH ${remaining.toFixed(1)}s`
    : ready ? "TAP! SMASH" : `SMASH ${percent}%`;
  smashGauge.setAttribute("aria-valuenow", String(percent));
  smashGauge.setAttribute("aria-valuetext", active ? `スマッシュ残り${remaining.toFixed(1)}秒` : ready ? "発動可能" : `${percent}パーセント`);
}

const game = new BlockBreakerGame(canvas, {
  onTimeChange: (time) => { timeElement.textContent = formatTime(time); },
  onLivesChange: (lives) => { livesElement.textContent = `♥ ${lives}`; },
  onEffectsChange: renderEffects,
  onSmashChange: renderSmashGauge,
  onSound: (name) => audio.playSe(name),
  onStateChange: (state) => {
    launchGuide.classList.toggle("hidden", state !== "waiting");
    if (state === "running") audio.startBgm();
    if (["waiting", "paused", "cleared", "gameover"].includes(state)) audio.stopBgm();
  },
  onLaunch: () => {
    if (!sharedStageActive || sharedPlayAttempt) return;
    const publicId = currentStage.id.slice("shared-".length);
    sharedPlayAttempt = beginSharedPlay(publicId).then((result) => result.playId).catch(() => null);
  },
  onClear: (time) => {
    audio.stopBgm();
    audio.playClear();
    document.querySelector("#clear-stage-name").textContent = currentStage.title;
    document.querySelector("#clear-time").textContent = formatTime(time);
    const clearShareStatus = document.querySelector("#clear-share-status");
    clearShareStatus.textContent = "";
    clearShareStatus.classList.remove("error");
    if (makerTestActive) {
      draftClear = {
        fingerprint: makerTestFingerprint || getMakerStageFingerprint(currentStage),
        time,
      };
      if (currentMakerRecord) {
        const saveResult = saveMakerStage(currentStage, {
          stageId: currentMakerRecord.id,
          authorClearTime: time,
          clearedFingerprint: draftClear.fingerprint,
        });
        if (saveResult.ok) {
          currentMakerRecord = saveResult.record;
          draftClear = {
            fingerprint: saveResult.record.clearedFingerprint,
            time: saveResult.record.authorClearTime,
          };
          maker.setIdentity(saveResult.record.id, saveResult.record.title);
          document.querySelector("#best-message").textContent = "テストクリア！投稿可能になりました";
        } else {
          document.querySelector("#best-message").textContent = "クリアしましたが保存に失敗しました";
          maker.setStatus(saveResult.error, true);
        }
      } else {
        document.querySelector("#best-message").textContent = "テストクリア！保存すると投稿可能状態を残せます";
      }
      updateMakerPublishStatus();
    } else {
      const result = saveBestTime(currentStage.id, time);
      document.querySelector("#best-message").textContent = result.isBest ? "✨ ベストタイム更新！" : `BEST ${formatTime(result.best)}`;
    }
    if (sharedStageActive && sharedPlayAttempt) {
      const publicId = currentStage.id.slice("shared-".length);
      void sharedPlayAttempt.then((playId) => playId ? reportSharedClear(publicId, playId) : null).catch(() => {});
    }
    window.setTimeout(() => showScreen("screen-clear"), 350);
  },
  onGameOver: () => {
    audio.stopBgm();
    window.setTimeout(() => showScreen("screen-gameover"), 300);
  },
});

const maker = new StageMaker({
  grid: document.querySelector("#maker-grid"),
  palette: document.querySelector("#maker-palette"),
  itemSettings: document.querySelector("#maker-item-settings"),
  itemSelect: document.querySelector("#maker-item-select"),
  count: document.querySelector("#maker-count"),
  nameElement: document.querySelector("#maker-stage-name"),
  publishStatus: document.querySelector("#maker-publish-status"),
  undoButton: document.querySelector("#btn-maker-undo"),
  redoButton: document.querySelector("#btn-maker-redo"),
  clearButton: document.querySelector("#btn-maker-clear"),
  saveButton: document.querySelector("#btn-maker-save"),
  testButton: document.querySelector("#btn-maker-test"),
  status: document.querySelector("#maker-status"),
  onSave: saveCurrentMakerStage,
  onTest: (stage) => {
    makerTestFingerprint = getMakerStageFingerprint(stage);
    startStage(stage, { makerTest: true });
  },
  onChange: () => {
    draftClear = null;
    updateMakerPublishStatus();
  },
});

function updateGameNavigation({ makerTest = false, shared = false } = {}) {
  document.querySelectorAll(".maker-test-only").forEach((element) => element.classList.toggle("hidden", !makerTest));
  document.querySelectorAll(".shared-only").forEach((element) => element.classList.toggle("hidden", !shared));
  document.querySelectorAll(".preset-only").forEach((element) => element.classList.toggle("hidden", makerTest || shared));
}

function prepareMakerScreen() {
  audio.stopBgm();
  game.stopLoop();
  pauseModal.classList.add("hidden");
  makerTestActive = false;
  sharedStageActive = false;
  updateGameNavigation();
}

function updateMakerPublishStatus() {
  const stage = maker.getStage();
  const fingerprint = getMakerStageFingerprint(stage);
  const ready = Boolean(maker.hasBreakableBlock()
    && currentMakerRecord
    && draftClear?.fingerprint === fingerprint
    && Number.isFinite(draftClear?.time));
  publishButton.disabled = !ready || publishing;
  maker.setPublishStatus(
    publishing ? "投稿中" : ready ? `投稿可能・CLEAR ${formatTime(draftClear.time)}` : "投稿不可",
    ready,
  );
}

async function publishCurrentMakerStage() {
  if (publishing || !currentMakerRecord || !isMakerStageCleared(currentMakerRecord)) return;
  if (!window.confirm("このクリア済みステージを投稿しますか？\n投稿済みデータは後から変更されません。")) return;

  publishing = true;
  maker.setStatus("投稿しています…");
  updateMakerPublishStatus();
  try {
    const result = await publishStage(currentMakerRecord.stage, currentMakerRecord.authorClearTime);
    const shareUrl = new URL(result.url, window.location.origin).href;
    document.querySelector("#published-stage-name").textContent = result.stage.title;
    document.querySelector("#published-url").value = shareUrl;
    document.querySelector("#link-play-published").href = shareUrl;
    const publishedStatus = document.querySelector("#published-status");
    publishedStatus.textContent = "";
    publishedStatus.classList.remove("error");
    showScreen("screen-published");
  } catch (error) {
    maker.setStatus(error instanceof Error ? error.message : "投稿に失敗しました", true);
  } finally {
    publishing = false;
    updateMakerPublishStatus();
  }
}

async function shareFromButton(button, status, { text, url }) {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = "";
  status.classList.remove("error");
  try {
    const result = await shareStage({
      title: "ブロック崩しメーカー",
      text,
      url,
    });
    if (result === "copied") status.textContent = "URLをコピーしました";
  } catch {
    status.textContent = "共有できませんでした。ブラウザのアドレスをコピーしてください";
    status.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

function saveCurrentMakerStage(stage) {
  const fingerprint = getMakerStageFingerprint(stage);
  const clearIsCurrent = draftClear?.fingerprint === fingerprint;
  const result = saveMakerStage(stage, {
    stageId: currentMakerRecord?.id || null,
    authorClearTime: clearIsCurrent ? draftClear.time : null,
    clearedFingerprint: clearIsCurrent ? draftClear.fingerprint : null,
  });
  if (!result.ok) {
    maker.setStatus(result.error, true);
    return;
  }
  currentMakerRecord = result.record;
  maker.setIdentity(result.record.id, result.record.title);
  draftClear = isMakerStageCleared(result.record)
    ? { fingerprint: result.record.clearedFingerprint, time: result.record.authorClearTime }
    : null;
  maker.setStatus("端末内に保存しました");
  updateMakerPublishStatus();
}

function buildMakerLibrary() {
  const list = document.querySelector("#maker-saved-list");
  const status = document.querySelector("#maker-library-status");
  const newButton = document.querySelector("#btn-maker-new");
  const library = loadMakerLibrary();
  status.textContent = library.error || "";
  status.classList.toggle("error", !library.ok);
  newButton.disabled = library.ok && library.stages.length >= MAX_LOCAL_STAGES;

  if (library.ok && library.stages.length >= MAX_LOCAL_STAGES) {
    status.textContent = "保存上限は10ステージです。不要なステージを削除してください";
  }

  const records = library.stages.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "maker-empty";
    empty.textContent = "保存されたステージはありません";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...records.map((record) => {
    const card = document.createElement("article");
    card.className = "maker-saved-card";

    const info = document.createElement("div");
    info.className = "maker-saved-info";
    const title = document.createElement("strong");
    title.textContent = record.title;
    const state = document.createElement("span");
    const cleared = isMakerStageCleared(record);
    state.classList.toggle("ready", cleared);
    state.textContent = cleared
      ? `投稿可能・CLEAR ${formatTime(record.authorClearTime)}`
      : "投稿不可・テストクリアが必要";
    info.append(title, state);

    const actions = document.createElement("div");
    actions.className = "maker-saved-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "maker-card-button maker-card-edit";
    editButton.textContent = "編集";
    editButton.addEventListener("click", () => openSavedMaker(record));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "maker-card-button maker-card-delete";
    deleteButton.textContent = "削除";
    deleteButton.addEventListener("click", () => {
      if (!window.confirm(record.title + "を削除しますか？")) return;
      const result = deleteMakerStage(record.id);
      if (!result.ok) {
        status.textContent = result.error;
        status.classList.add("error");
        return;
      }
      buildMakerLibrary();
    });
    actions.append(editButton, deleteButton);
    card.append(info, actions);
    return card;
  }));
}

function openMakerLibrary() {
  prepareMakerScreen();
  buildMakerLibrary();
  showScreen("screen-maker-library");
}

function openNewMaker() {
  prepareMakerScreen();
  currentMakerRecord = null;
  draftClear = null;
  maker.reset({ title: getNextMakerTitle() });
  updateMakerPublishStatus();
  showScreen("screen-maker");
}

function openSavedMaker(record) {
  prepareMakerScreen();
  if (!maker.loadStage(record.stage)) {
    const status = document.querySelector("#maker-library-status");
    status.textContent = "このステージは読み込めません";
    status.classList.add("error");
    return;
  }
  currentMakerRecord = record;
  draftClear = isMakerStageCleared(record)
    ? { fingerprint: record.clearedFingerprint, time: record.authorClearTime }
    : null;
  updateMakerPublishStatus();
  showScreen("screen-maker");
}

function returnToMaker() {
  prepareMakerScreen();
  maker.render();
  updateMakerPublishStatus();
  showScreen("screen-maker");
}

function buildStageList() {
  const list = document.querySelector("#stage-list");
  list.replaceChildren(...STAGES.map((stage) => {
    const button = document.createElement("button");
    const best = getBestTime(stage.id);
    button.type = "button";
    button.className = "stage-button";
    button.innerHTML = `<strong>${stage.title}</strong><span>${stage.subtitle}</span><em>${best ? `BEST ${formatTime(best)}` : "NEW"}</em>`;
    button.addEventListener("click", () => startStage(stage));
    return button;
  }));
}

function startStage(stage, { makerTest = false, shared = false } = {}) {
  sharedPlayAttempt = null;
  currentStage = stage;
  makerTestActive = makerTest;
  sharedStageActive = shared;
  updateGameNavigation({ makerTest, shared });
  stageNameElement.textContent = stage.title;
  pauseModal.classList.add("hidden");
  showScreen("screen-game");
  requestAnimationFrame(() => {
    resizeGame();
    game.loadStage(stage);
  });
}

function renderCommunityStages(stages, append = false) {
  const list = document.querySelector("#community-list");
  if (!append) list.replaceChildren();
  for (const stage of stages) {
    const link = document.createElement("a");
    link.className = "community-item";
    link.href = `/s/${encodeURIComponent(stage.publicId)}`;

    const preview = document.createElement("canvas");
    preview.className = "community-stage-preview";
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", `${stage.title}の配置プレビュー`);

    const content = document.createElement("div");
    content.className = "community-item-content";
    const title = document.createElement("strong");
    title.textContent = stage.title;
    content.append(title);
    if (stage.viewerCleared === true) {
      const badge = document.createElement("span");
      badge.className = "community-clear-badge";
      badge.textContent = "✓ クリア済み";
      content.append(badge);
    }
    const detail = document.createElement("span");
    detail.textContent = `プレイ ${stage.uniquePlays}端末 · クリア ${stage.uniqueClears}端末 · クリア率 ${stage.clearRate === null ? "—" : `${stage.clearRate}%`}`;
    content.append(detail);
    link.append(preview, content);
    list.append(link);
    drawStagePreview(preview, stage.preview);
  }
}

async function loadCommunity({ append = false } = {}) {
  if (communityLoading) return;
  communityLoading = true;
  const generation = communityGeneration;
  const kind = communityKind;
  const status = document.querySelector("#community-status");
  const more = document.querySelector("#btn-community-more");
  more.disabled = true;
  status.textContent = "読み込み中…";
  try {
    const result = kind === "current" ? await fetchCommunityList(append ? communityCursor : null) : await fetchCommunityRanking(kind);
    if (generation !== communityGeneration) return;
    renderCommunityStages(result.stages, append);
    communityCursor = kind === "current" ? result.nextCursor : null;
    more.classList.toggle("hidden", !communityCursor);
    document.querySelector("#community-period").textContent = kind === "all-time" ? "これまでの投稿" : `${kind === "current" ? result.month : result.period}（日本時間）`;
    status.textContent = result.stages.length ? "" : append ? "これ以上ありません" : "まだステージがありません";
  } catch {
    if (generation !== communityGeneration) return;
    status.textContent = "一覧を読み込めませんでした。もう一度お試しください";
    if (append) more.classList.remove("hidden");
  } finally {
    if (generation === communityGeneration) {
      more.disabled = false;
      communityLoading = false;
    }
  }
}

function openCommunity(kind = "current") {
  communityGeneration += 1;
  communityLoading = false;
  communityKind = kind;
  communityCursor = null;
  document.querySelectorAll("[data-community-kind]").forEach((button) => button.classList.toggle("selected", button.dataset.communityKind === kind));
  document.querySelector("#community-list").replaceChildren();
  document.querySelector("#btn-community-more").classList.add("hidden");
  showScreen("screen-community");
  void loadCommunity();
}

function restartStage() {
  startStage(currentStage, { makerTest: makerTestActive, shared: sharedStageActive });
}

function returnToStages() {
  audio.stopBgm();
  game.stopLoop();
  pauseModal.classList.add("hidden");
  makerTestActive = false;
  sharedStageActive = false;
  updateGameNavigation();
  buildStageList();
  showScreen("screen-stages");
}

function returnToTitle() {
  window.location.assign("/");
}

async function openSharedStage(publicId) {
  showScreen("screen-shared-loading");
  try {
    const result = await fetchSharedStage(publicId);
    startStage(result.stage, { shared: true });
  } catch (error) {
    document.querySelector("#shared-loading-title").textContent = "ステージを開けませんでした";
    document.querySelector("#shared-loading-message").textContent = error instanceof Error
      ? error.message
      : "時間をおいてもう一度お試しください";
    document.querySelector("#btn-shared-title").classList.remove("hidden");
  }
}

document.querySelector("#btn-start").addEventListener("click", () => {
  audio.ensureContext();
  buildStageList();
  showScreen("screen-stages");
});
document.querySelector("#btn-make").addEventListener("click", () => {
  audio.ensureContext();
  openMakerLibrary();
});
document.querySelector("#btn-community").addEventListener("click", () => openCommunity());
document.querySelector("#btn-community-back").addEventListener("click", () => showScreen("screen-title"));
document.querySelectorAll("[data-community-kind]").forEach((button) => button.addEventListener("click", () => openCommunity(button.dataset.communityKind)));
document.querySelector("#btn-community-more").addEventListener("click", () => void loadCommunity({ append: true }));
document.querySelector("#btn-stage-back").addEventListener("click", () => showScreen("screen-title"));
document.querySelector("#btn-maker-library-back").addEventListener("click", () => showScreen("screen-title"));
document.querySelector("#btn-maker-new").addEventListener("click", openNewMaker);
document.querySelector("#btn-maker-back").addEventListener("click", openMakerLibrary);
publishButton.addEventListener("click", publishCurrentMakerStage);
document.querySelector("#btn-clear-retry").addEventListener("click", restartStage);
document.querySelector("#btn-clear-stages").addEventListener("click", returnToStages);
document.querySelector("#btn-clear-make").addEventListener("click", openNewMaker);
document.querySelector("#btn-clear-editor").addEventListener("click", returnToMaker);
document.querySelector("#btn-clear-share").addEventListener("click", () => {
  if (!sharedStageActive || !currentStage.id.startsWith("shared-")) return;
  const publicId = currentStage.id.slice("shared-".length);
  const url = new URL(`/s/${encodeURIComponent(publicId)}`, window.location.origin).href;
  void shareFromButton(
    document.querySelector("#btn-clear-share"),
    document.querySelector("#clear-share-status"),
    { text: `「${currentStage.title}」をクリア！挑戦してみて！`, url },
  );
});
document.querySelector("#btn-gameover-retry").addEventListener("click", restartStage);
document.querySelector("#btn-gameover-stages").addEventListener("click", returnToStages);
document.querySelector("#btn-gameover-editor").addEventListener("click", returnToMaker);
document.querySelector("#btn-shared-title").addEventListener("click", returnToTitle);
document.querySelectorAll('[data-action="shared-title"]').forEach((button) => button.addEventListener("click", returnToTitle));
document.querySelector("#btn-published-editor").addEventListener("click", returnToMaker);
document.querySelector("#btn-share-published").addEventListener("click", () => {
  const stageTitle = document.querySelector("#published-stage-name").textContent;
  void shareFromButton(
    document.querySelector("#btn-share-published"),
    document.querySelector("#published-status"),
    {
      text: `「${stageTitle}」を作ったよ！遊んでみて！`,
      url: document.querySelector("#published-url").value,
    },
  );
});
document.querySelector("#btn-copy-published-url").addEventListener("click", async () => {
  const status = document.querySelector("#published-status");
  status.classList.remove("error");
  try {
    await copyShareUrl(document.querySelector("#published-url").value);
    status.textContent = "URLをコピーしました";
  } catch {
    status.textContent = "コピーできませんでした。URLを長押ししてコピーしてください";
    status.classList.add("error");
  }
});

document.querySelector("#btn-pause").addEventListener("click", () => {
  if (game.pause()) pauseModal.classList.remove("hidden");
});
document.querySelector("#btn-resume").addEventListener("click", () => {
  pauseModal.classList.add("hidden");
  game.resume();
});
document.querySelector("#btn-restart").addEventListener("click", restartStage);
document.querySelector("#btn-quit").addEventListener("click", returnToStages);
document.querySelector("#btn-pause-editor").addEventListener("click", returnToMaker);

const bgmButton = document.querySelector("#toggle-bgm");
const seButton = document.querySelector("#toggle-se");
updateSoundButton(bgmButton, settings.bgm);
updateSoundButton(seButton, settings.se);

document.querySelector("#btn-settings").addEventListener("click", () => settingsModal.classList.remove("hidden"));
document.querySelector("#btn-settings-close").addEventListener("click", () => settingsModal.classList.add("hidden"));
bgmButton.addEventListener("click", () => {
  settings.bgm = !settings.bgm;
  audio.setBgmEnabled(settings.bgm);
  updateSoundButton(bgmButton, settings.bgm);
  saveSettings(settings);
});
seButton.addEventListener("click", () => {
  settings.se = !settings.se;
  audio.setSeEnabled(settings.se);
  updateSoundButton(seButton, settings.se);
  saveSettings(settings);
});

canvas.addEventListener("pointerdown", (event) => {
  if (activePointer) return;
  activePointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
  game.movePaddle(game.canvasX(event.clientX));
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" && !activePointer) {
    game.movePaddle(game.canvasX(event.clientX));
    return;
  }
  if (!activePointer || activePointer.id !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - activePointer.startX, event.clientY - activePointer.startY);
  if (distance > 9) activePointer.moved = true;
  game.movePaddle(game.canvasX(event.clientX));
  event.preventDefault();
});

function finishPointer(event) {
  if (!activePointer || activePointer.id !== event.pointerId) return;
  const shouldLaunch = !activePointer.moved && event.type === "pointerup";
  activePointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (shouldLaunch) {
    game.activateSmash();
    game.launch();
  }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);

function clearGameSelection() {
  const selection = window.getSelection?.();
  if (selection?.rangeCount) selection.removeAllRanges();
}

function preventNativeGameGesture(event) {
  if (event.cancelable) event.preventDefault();
  clearGameSelection();
}

gameWrap.addEventListener("selectstart", preventNativeGameGesture, true);
gameWrap.addEventListener("dragstart", preventNativeGameGesture, true);
gameWrap.addEventListener("dblclick", preventNativeGameGesture, true);
gameWrap.addEventListener("contextmenu", preventNativeGameGesture, true);
["touchstart", "touchmove", "touchend"].forEach((type) => {
  gameWrap.addEventListener(type, preventNativeGameGesture, { passive: false, capture: true });
});
["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
  gameWrap.addEventListener(type, preventNativeGameGesture, true);
});
document.addEventListener("selectionchange", () => {
  if (!gameScreen.classList.contains("hidden")) clearGameSelection();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && game.pause()) pauseModal.classList.remove("hidden");
});

function resizeGame() {
  const wrap = document.querySelector("#game-wrap");
  const rect = wrap.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const scale = Math.min(rect.width / 360, rect.height / 560);
  canvas.style.width = `${360 * scale}px`;
  canvas.style.height = `${560 * scale}px`;
  game.resize();
}

const resizeObserver = new ResizeObserver(resizeGame);
resizeObserver.observe(document.querySelector("#game-wrap"));

const sharedStageId = getSharedStageId();
if (sharedStageId) void openSharedStage(sharedStageId);
else showScreen("screen-title");
