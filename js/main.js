import { AudioManager } from "./audio.js";
import { BlockBreakerGame } from "./game.js";
import { StageMaker } from "./maker.js";
import { STAGES } from "./stages.js";
import { getBestTime, loadSettings, saveBestTime, saveSettings } from "./storage.js";

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
const settings = loadSettings();
const audio = new AudioManager(settings);

let currentStage = STAGES[0];
let activePointer = null;
let makerTestActive = false;

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
  onClear: (time) => {
    audio.stopBgm();
    audio.playClear();
    document.querySelector("#clear-stage-name").textContent = currentStage.title;
    document.querySelector("#clear-time").textContent = formatTime(time);
    if (makerTestActive) {
      document.querySelector("#best-message").textContent = "テストクリア！編集に戻って調整できます";
    } else {
      const result = saveBestTime(currentStage.id, time);
      document.querySelector("#best-message").textContent = result.isBest ? "✨ ベストタイム更新！" : `BEST ${formatTime(result.best)}`;
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
  undoButton: document.querySelector("#btn-maker-undo"),
  redoButton: document.querySelector("#btn-maker-redo"),
  clearButton: document.querySelector("#btn-maker-clear"),
  testButton: document.querySelector("#btn-maker-test"),
  status: document.querySelector("#maker-status"),
  onTest: (stage) => startStage(stage, { makerTest: true }),
});

function updateMakerTestNavigation(active) {
  document.querySelectorAll(".maker-test-only").forEach((element) => element.classList.toggle("hidden", !active));
  document.querySelectorAll(".preset-only").forEach((element) => element.classList.toggle("hidden", active));
}

function openMaker() {
  audio.stopBgm();
  game.stopLoop();
  pauseModal.classList.add("hidden");
  makerTestActive = false;
  updateMakerTestNavigation(false);
  maker.render();
  showScreen("screen-maker");
}

function returnToMaker() {
  openMaker();
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

function startStage(stage, { makerTest = false } = {}) {
  currentStage = stage;
  makerTestActive = makerTest;
  updateMakerTestNavigation(makerTestActive);
  stageNameElement.textContent = stage.title;
  pauseModal.classList.add("hidden");
  showScreen("screen-game");
  requestAnimationFrame(() => {
    resizeGame();
    game.loadStage(stage);
  });
}

function restartStage() {
  startStage(currentStage, { makerTest: makerTestActive });
}

function returnToStages() {
  audio.stopBgm();
  game.stopLoop();
  pauseModal.classList.add("hidden");
  makerTestActive = false;
  updateMakerTestNavigation(false);
  buildStageList();
  showScreen("screen-stages");
}

document.querySelector("#btn-start").addEventListener("click", () => {
  audio.ensureContext();
  buildStageList();
  showScreen("screen-stages");
});
document.querySelector("#btn-make").addEventListener("click", () => {
  audio.ensureContext();
  openMaker();
});
document.querySelector("#btn-stage-back").addEventListener("click", () => showScreen("screen-title"));
document.querySelector("#btn-maker-back").addEventListener("click", () => showScreen("screen-title"));
document.querySelector("#btn-clear-retry").addEventListener("click", restartStage);
document.querySelector("#btn-clear-stages").addEventListener("click", returnToStages);
document.querySelector("#btn-clear-make").addEventListener("click", openMaker);
document.querySelector("#btn-clear-editor").addEventListener("click", returnToMaker);
document.querySelector("#btn-gameover-retry").addEventListener("click", restartStage);
document.querySelector("#btn-gameover-stages").addEventListener("click", returnToStages);
document.querySelector("#btn-gameover-editor").addEventListener("click", returnToMaker);

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

showScreen("screen-title");
