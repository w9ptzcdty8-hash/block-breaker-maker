import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FIXED_STEP,
  circleRectCollision,
  clamp,
  limitShallowAngle,
  reflectFromPaddle,
  resolveCollision,
} from "./physics.js";
import { BLOCK_TYPES, ITEM_TYPES, validateStage } from "./stages.js";

const GRID_MARGIN_X = 6;
const GRID_TOP = 34;
const GRID_CELL_HEIGHT = 23;
const BLOCK_GAP = 1;
const BLOCK_HEIGHT = 22;
const PADDLE_Y = 485;
const NORMAL_PADDLE_WIDTH = 72;
const LARGE_PADDLE_WIDTH = 108;
const BALL_RADIUS = 6;
const LARGE_BALL_RADIUS = 9;
const BALL_SPEED = 280;
const ITEM_SPEED = 110;
const MAX_LIVES = 5;
const RANDOM_DROP_RATE = 0.08;
const INITIAL_EXPLOSION_DELAY = 0.06;
const CHAIN_EXPLOSION_DELAY = 0.14;
const EXPLOSION_EFFECT_DURATION = 0.32;
const BLOCK_FLASH_DURATION = 0.18;
const SMASH_MAX_CHARGE = 20;
const SMASH_DURATION = 10;
const SMASH_SPEED_MULTIPLIER = 1.2;

const EFFECT_DURATIONS = Object.freeze({
  paddle: 12,
  largeBall: 10,
  explosiveBall: 10,
});

const ITEM_LABELS = Object.freeze({
  [ITEM_TYPES.PADDLE]: "WIDE",
  [ITEM_TYPES.MULTIBALL]: "+BALL",
  [ITEM_TYPES.LARGE_BALL]: "BIG",
  [ITEM_TYPES.EXPLOSIVE_BALL]: "BOOM",
  [ITEM_TYPES.LIFE]: "1UP",
});

const BLOCK_HP = Object.freeze({
  [BLOCK_TYPES.NORMAL]: 1,
  [BLOCK_TYPES.HIT_2]: 2,
  [BLOCK_TYPES.HIT_3]: 3,
  [BLOCK_TYPES.SOLID]: Infinity,
  [BLOCK_TYPES.EXPLOSIVE]: 1,
  [BLOCK_TYPES.ITEM]: 1,
});

const BLOCK_IMAGE_URLS = Object.freeze({
  normal: new URL("../assets/images/block-normal.png", import.meta.url).href,
  hit2: new URL("../assets/images/block-2hit.png", import.meta.url).href,
  hit3: new URL("../assets/images/block-3hit.png", import.meta.url).href,
  solid: new URL("../assets/images/block-unbreakable.png", import.meta.url).href,
  explosive: new URL("../assets/images/block-bomb.png", import.meta.url).href,
});

const ITEM_IMAGE_URLS = Object.freeze({
  [ITEM_TYPES.PADDLE]: new URL("../assets/images/item-paddle-wide.png", import.meta.url).href,
  [ITEM_TYPES.MULTIBALL]: new URL("../assets/images/item-multiball.png", import.meta.url).href,
  [ITEM_TYPES.LARGE_BALL]: new URL("../assets/images/item-large-ball.png", import.meta.url).href,
  [ITEM_TYPES.EXPLOSIVE_BALL]: new URL("../assets/images/item-explosive-ball.png", import.meta.url).href,
  [ITEM_TYPES.LIFE]: new URL("../assets/images/item-life.png", import.meta.url).href,
});

const BLOCK_IMAGE_CROP = Object.freeze({
  x: 9 / 256,
  y: 14 / 128,
  width: 238 / 256,
  height: 103 / 128,
});

export class BlockBreakerGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.callbacks = callbacks;
    this.stage = null;
    this.state = "idle";
    this.stateBeforePause = "waiting";
    this.lastFrameTime = 0;
    this.accumulator = 0;
    this.elapsed = 0;
    this.lives = 3;
    this.blocks = [];
    this.blockMap = new Map();
    this.balls = [];
    this.items = [];
    this.pendingExplosions = [];
    this.explosionEffects = [];
    this.debris = [];
    this.nextChainExplosionAt = 0;
    this.effects = { paddleUntil: 0, largeBallUntil: 0, explosiveBallUntil: 0 };
    this.lastEffectSignature = "";
    this.smashCharge = 0;
    this.smashActive = false;
    this.smashRemaining = 0;
    this.smashFlash = 0;
    this.lastSmashSignature = "";
    this.blockImages = this.createBlockImages();
    this.itemImages = this.createItemImages();
    this.paddle = { x: (BOARD_WIDTH - NORMAL_PADDLE_WIDTH) / 2, y: PADDLE_Y, width: NORMAL_PADDLE_WIDTH, height: 12 };
    this.animationId = null;
    this.loop = this.loop.bind(this);
  }

  createBlockImages() {
    if (typeof Image === "undefined") return {};
    return Object.fromEntries(Object.entries(BLOCK_IMAGE_URLS).map(([key, source]) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => this.draw(), { once: true });
      image.src = source;
      return [key, image];
    }));
  }

  createItemImages() {
    if (typeof Image === "undefined") return {};
    return Object.fromEntries(Object.entries(ITEM_IMAGE_URLS).map(([key, source]) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => this.draw(), { once: true });
      image.src = source;
      return [key, image];
    }));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.draw();
    }
  }

  loadStage(stage) {
    if (!validateStage(stage)) throw new Error("Invalid stage data");
    this.stage = stage;
    this.elapsed = 0;
    this.lives = 3;
    this.blocks = this.createBlocks(stage);
    this.blockMap = new Map(this.blocks.map((entry) => [`${entry.gridX},${entry.gridY}`, entry]));
    this.pendingExplosions = [];
    this.explosionEffects = [];
    this.debris = [];
    this.nextChainExplosionAt = 0;
    this.resetSmash();
    this.resetRound(true);
    this.state = "waiting";
    this.callbacks.onStateChange?.(this.state);
    this.callbacks.onLivesChange?.(this.lives);
    this.callbacks.onTimeChange?.(this.elapsed);
    this.startLoop();
  }

  createBlocks(stage) {
    const cellWidth = (BOARD_WIDTH - GRID_MARGIN_X * 2) / stage.grid.columns;
    return stage.blocks.map((entry) => ({
      ...entry,
      x: GRID_MARGIN_X + entry.x * cellWidth + BLOCK_GAP / 2,
      y: GRID_TOP + entry.y * GRID_CELL_HEIGHT,
      width: cellWidth - BLOCK_GAP,
      height: BLOCK_HEIGHT,
      gridX: entry.x,
      gridY: entry.y,
      hp: BLOCK_HP[entry.type],
      maxHp: BLOCK_HP[entry.type],
      active: true,
      exploded: false,
      explosionScheduled: false,
      pendingExplosion: false,
      blastFlash: 0,
      explosionAt: 0,
    }));
  }

  startLoop() {
    if (this.animationId) return;
    this.lastFrameTime = performance.now();
    this.animationId = requestAnimationFrame(this.loop);
  }

  stopLoop() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.animationId = null;
  }

  loop(now) {
    const frameTime = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (this.state === "running") {
      this.accumulator += frameTime;
      while (this.accumulator >= FIXED_STEP) {
        this.update(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
    }

    if (this.state === "running" || this.state === "cleared") {
      this.updateVisualEffects(frameTime);
    }

    this.draw();
    this.animationId = requestAnimationFrame(this.loop);
  }

  launch() {
    if (this.state !== "waiting") return false;
    const ball = this.balls[0];
    const direction = Math.random() < 0.5 ? -1 : 1;
    const speed = BALL_SPEED * (this.smashActive ? SMASH_SPEED_MULTIPLIER : 1);
    ball.vx = speed * 0.55 * direction;
    ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
    ball.smashBoosted = this.smashActive;
    this.state = "running";
    this.callbacks.onStateChange?.(this.state);
    this.callbacks.onLaunch?.();
    this.callbacks.onSound?.("launch");
    return true;
  }

  pause() {
    if (this.state !== "running" && this.state !== "waiting") return false;
    this.stateBeforePause = this.state;
    this.state = "paused";
    this.accumulator = 0;
    this.callbacks.onStateChange?.(this.state);
    return true;
  }

  resume() {
    if (this.state !== "paused") return false;
    this.state = this.stateBeforePause;
    this.lastFrameTime = performance.now();
    this.callbacks.onStateChange?.(this.state);
    return true;
  }

  movePaddle(logicalX) {
    this.paddle.x = clamp(logicalX - this.paddle.width / 2, 0, BOARD_WIDTH - this.paddle.width);
    if (this.state === "waiting" && this.balls[0]) this.attachWaitingBall();
  }

  resetRound(resetEffects = false) {
    this.items = [];
    if (resetEffects) this.clearEffects();
    this.paddle.width = NORMAL_PADDLE_WIDTH;
    this.paddle.x = (BOARD_WIDTH - this.paddle.width) / 2;
    this.balls = [{
      x: BOARD_WIDTH / 2,
      y: this.paddle.y - BALL_RADIUS - 1,
      vx: 0,
      vy: 0,
      radius: BALL_RADIUS,
      smashBoosted: false,
      smashContacts: new Set(),
      trail: [],
    }];
    if (this.smashActive) this.boostBallForSmash(this.balls[0]);
  }

  attachWaitingBall() {
    const ball = this.balls[0];
    ball.x = this.paddle.x + this.paddle.width / 2;
    ball.y = this.paddle.y - ball.radius - 1;
  }

  clearEffects() {
    this.effects = { paddleUntil: 0, largeBallUntil: 0, explosiveBallUntil: 0 };
    this.lastEffectSignature = "";
    this.callbacks.onEffectsChange?.([]);
  }

  resetSmash() {
    this.smashCharge = 0;
    this.smashActive = false;
    this.smashRemaining = 0;
    this.smashFlash = 0;
    this.lastSmashSignature = "";
    this.emitSmash(true);
  }

  activateSmash() {
    if (this.smashActive || this.smashCharge < SMASH_MAX_CHARGE) return false;
    if (this.state !== "running" && this.state !== "waiting") return false;
    this.smashActive = true;
    this.smashRemaining = SMASH_DURATION;
    this.smashFlash = 0.45;
    this.balls.forEach((ball) => this.boostBallForSmash(ball));
    this.callbacks.onSound?.("smash");
    this.emitSmash(true);
    return true;
  }

  boostBallForSmash(ball) {
    if (ball.smashBoosted) return;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 0) {
      ball.vx *= SMASH_SPEED_MULTIPLIER;
      ball.vy *= SMASH_SPEED_MULTIPLIER;
    }
    ball.smashBoosted = true;
    ball.smashContacts = new Set();
    ball.trail = [];
  }

  endSmash() {
    this.smashActive = false;
    this.smashCharge = 0;
    this.smashRemaining = 0;
    this.balls.forEach((ball) => {
      if (ball.smashBoosted && Math.hypot(ball.vx, ball.vy) > 0) {
        ball.vx /= SMASH_SPEED_MULTIPLIER;
        ball.vy /= SMASH_SPEED_MULTIPLIER;
      }
      ball.smashBoosted = false;
      ball.smashContacts = new Set();
      ball.trail = [];
    });
    this.emitSmash(true);
  }

  updateSmash(dt) {
    if (!this.smashActive) return;
    this.smashRemaining = Math.max(0, this.smashRemaining - dt);
    if (this.smashRemaining <= 0) this.endSmash();
    else this.emitSmash();
  }

  addSmashCharge(amount) {
    if (this.smashActive) return;
    this.smashCharge = Math.min(SMASH_MAX_CHARGE, this.smashCharge + amount);
    this.emitSmash();
  }

  emitSmash(force = false) {
    const ratio = this.smashActive
      ? this.smashRemaining / SMASH_DURATION
      : this.smashCharge / SMASH_MAX_CHARGE;
    const ready = !this.smashActive && this.smashCharge >= SMASH_MAX_CHARGE;
    const signature = `${this.smashActive}:${ready}:${Math.round(ratio * 100)}:${Math.ceil(this.smashRemaining * 10)}`;
    if (!force && signature === this.lastSmashSignature) return;
    this.lastSmashSignature = signature;
    this.callbacks.onSmashChange?.({
      ratio: clamp(ratio, 0, 1),
      active: this.smashActive,
      ready,
      remaining: this.smashRemaining,
    });
  }

  update(dt) {
    this.elapsed += dt;
    this.callbacks.onTimeChange?.(this.elapsed);
    this.updateSmash(dt);
    this.updateEffects();
    this.processPendingExplosions();
    if (this.state !== "running") return;

    for (let index = this.balls.length - 1; index >= 0; index -= 1) {
      const ball = this.balls[index];
      this.updateBall(ball, dt);
      if (ball.y - ball.radius > BOARD_HEIGHT) this.balls.splice(index, 1);
      if (this.state !== "running") return;
    }

    this.updateItems(dt);

    if (this.balls.length === 0) this.loseLife();
  }

  updateBall(ball, dt) {
    if (this.smashActive) {
      ball.trail ??= [];
      ball.trail.push({ x: ball.x, y: ball.y, radius: ball.radius });
      if (ball.trail.length > 9) ball.trail.shift();
    } else if (ball.trail?.length) {
      ball.trail = [];
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    let reflectedByWall = false;
    if (ball.x - ball.radius < 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx);
      reflectedByWall = true;
    } else if (ball.x + ball.radius > BOARD_WIDTH) {
      ball.x = BOARD_WIDTH - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      reflectedByWall = true;
    }

    if (ball.y - ball.radius < 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
      reflectedByWall = true;
    }
    if (reflectedByWall) limitShallowAngle(ball);

    if (ball.vy > 0) {
      const paddleCollision = circleRectCollision(ball, this.paddle);
      if (paddleCollision) {
        reflectFromPaddle(ball, this.paddle);
        this.callbacks.onSound?.("paddle");
      }
    }

    if (this.smashActive) {
      this.resolveSmashCollisions(ball);
      return;
    }

    let collisionTarget = null;
    let collisionInfo = null;
    for (const target of this.blocks) {
      if (!target.active) continue;
      const collision = circleRectCollision(ball, target);
      if (collision && (!collisionInfo || collision.penetration > collisionInfo.penetration)) {
        collisionTarget = target;
        collisionInfo = collision;
      }
    }

    if (collisionTarget && collisionInfo) {
      resolveCollision(ball, collisionInfo);
      this.hitBlock(collisionTarget, this.isEffectActive("explosiveBall") ? "explosiveBall" : "direct");
    }
  }

  resolveSmashCollisions(ball) {
    const previousContacts = ball.smashContacts ?? new Set();
    const currentContacts = new Set();
    let solidTarget = null;
    let solidCollision = null;

    for (const target of this.blocks) {
      if (!target.active) continue;
      const collision = circleRectCollision(ball, target);
      if (!collision) continue;

      if (target.type === BLOCK_TYPES.SOLID) {
        currentContacts.add(target);
        if (!solidCollision || collision.penetration > solidCollision.penetration) {
          solidTarget = target;
          solidCollision = collision;
        }
      } else {
        currentContacts.add(target);
        if (!previousContacts.has(target)) this.hitBlock(target, "smash");
      }
    }

    ball.smashContacts = currentContacts;
    if (solidTarget && solidCollision) {
      resolveCollision(ball, solidCollision);
      if (!previousContacts.has(solidTarget)) this.hitBlock(solidTarget, "smash");
    }
  }

  hitBlock(target, attack = "direct") {
    const explosiveBall = attack === "explosiveBall" || attack === "smash";
    if (target.type === BLOCK_TYPES.SOLID) {
      if (explosiveBall) {
        this.scheduleBlast(target.gridX, target.gridY, attack === "smash" ? "smashBall" : "ball", 0);
      } else {
        this.callbacks.onSound?.("hit");
      }
      return;
    }

    const damageSource = attack === "smash" ? "smash" : explosiveBall ? "explosiveBall" : "direct";
    const destroyed = this.damageBlock(target, 1, damageSource);

    if (explosiveBall) {
      this.scheduleBlast(target.gridX, target.gridY, attack === "smash" ? "smashBall" : "ball", 0);
    } else {
      this.callbacks.onSound?.(destroyed ? "break" : "hit");
    }

    this.checkForStageClear();
  }

  scheduleBlast(gridX, gridY, kind, delay, sourceBlock = null) {
    const triggerAt = this.elapsed + delay;
    this.pendingExplosions.push({ gridX, gridY, kind, triggerAt, sourceBlock });
    this.pendingExplosions.sort((a, b) => a.triggerAt - b.triggerAt);
  }

  scheduleBlockExplosion(target, isChain) {
    if (target.explosionScheduled) return;
    target.explosionScheduled = true;
    target.pendingExplosion = true;

    let triggerAt;
    if (isChain) {
      triggerAt = Math.max(this.elapsed + CHAIN_EXPLOSION_DELAY, this.nextChainExplosionAt + CHAIN_EXPLOSION_DELAY);
      this.nextChainExplosionAt = triggerAt;
    } else {
      triggerAt = this.elapsed + INITIAL_EXPLOSION_DELAY;
      this.nextChainExplosionAt = Math.max(this.nextChainExplosionAt, triggerAt);
    }

    target.explosionAt = triggerAt;
    this.pendingExplosions.push({
      gridX: target.gridX,
      gridY: target.gridY,
      kind: "block",
      triggerAt,
      sourceBlock: target,
    });
    this.pendingExplosions.sort((a, b) => a.triggerAt - b.triggerAt);
  }

  processPendingExplosions() {
    while (this.pendingExplosions.length > 0 && this.pendingExplosions[0].triggerAt <= this.elapsed) {
      const blast = this.pendingExplosions.shift();
      if (blast.sourceBlock) blast.sourceBlock.pendingExplosion = false;
      this.createExplosionEffect(blast.gridX, blast.gridY, blast.kind);
      this.callbacks.onSound?.("explosion");
      const damageSource = blast.kind === "ball" ? "explosiveBall" : blast.kind === "smashBall" ? "smash" : "explosion";
      this.damageNeighbors(blast.gridX, blast.gridY, damageSource);
    }
    this.checkForStageClear();
  }

  damageNeighbors(gridX, gridY, source = "explosion") {
    for (let y = gridY - 1; y <= gridY + 1; y += 1) {
      for (let x = gridX - 1; x <= gridX + 1; x += 1) {
        if (x === gridX && y === gridY) continue;
        const neighbor = this.blockMap.get(`${x},${y}`);
        if (neighbor?.active && neighbor.type !== BLOCK_TYPES.SOLID) {
          this.damageBlock(neighbor, 1, source);
        }
      }
    }
  }

  damageBlock(target, damage, source = "direct") {
    if (!target.active || target.type === BLOCK_TYPES.SOLID) return false;
    if (source === "explosion" || source === "explosiveBall" || source === "smash") {
      target.blastFlash = BLOCK_FLASH_DURATION;
    }
    target.hp -= damage;
    if (source === "direct" || source === "explosiveBall") this.addSmashCharge(damage);
    if (target.hp > 0) return false;

    target.active = false;
    if (target.type === BLOCK_TYPES.EXPLOSIVE && !target.exploded) {
      target.exploded = true;
      this.scheduleBlockExplosion(target, source !== "direct");
    }
    if (source === "explosion" || source === "explosiveBall" || source === "smash") {
      this.createBlockDebris(target);
    }
    this.maybeDropItem(target);
    return true;
  }

  checkForStageClear() {
    if (this.state !== "running") return;
    const hasBreakableBlock = this.blocks.some((entry) => entry.active && entry.type !== BLOCK_TYPES.SOLID);
    if (!hasBreakableBlock && this.pendingExplosions.length === 0) this.finishStage();
  }

  createExplosionEffect(gridX, gridY, kind) {
    const cellWidth = (BOARD_WIDTH - GRID_MARGIN_X * 2) / 10;
    const x = GRID_MARGIN_X + (gridX + 0.5) * cellWidth;
    const y = GRID_TOP + gridY * GRID_CELL_HEIGHT + BLOCK_HEIGHT / 2;
    this.explosionEffects.push({ x, y, age: 0, duration: EXPLOSION_EFFECT_DURATION, kind });
  }

  createBlockDebris(target) {
    const colors = {
      [BLOCK_TYPES.NORMAL]: "#58a6ff",
      [BLOCK_TYPES.HIT_2]: "#35dc2f",
      [BLOCK_TYPES.HIT_3]: "#ff9f1c",
      [BLOCK_TYPES.EXPLOSIVE]: "#ff5f62",
      [BLOCK_TYPES.ITEM]: "#42d6a4",
    };
    const centerX = target.x + target.width / 2;
    const centerY = target.y + target.height / 2;
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI * 2 * index) / 6 + Math.random() * 0.45;
      const speed = 42 + Math.random() * 58;
      this.debris.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 28,
        size: 2 + Math.random() * 2.5,
        color: colors[target.type] || "#ffd166",
        age: 0,
        duration: 0.3 + Math.random() * 0.05,
      });
    }
    if (this.debris.length > 240) this.debris.splice(0, this.debris.length - 240);
  }

  updateVisualEffects(dt) {
    this.smashFlash = Math.max(0, this.smashFlash - dt);
    this.blocks.forEach((entry) => {
      entry.blastFlash = Math.max(0, entry.blastFlash - dt);
    });

    this.explosionEffects.forEach((effect) => { effect.age += dt; });
    this.explosionEffects = this.explosionEffects.filter((effect) => effect.age < effect.duration);

    this.debris.forEach((particle) => {
      particle.age += dt;
      particle.vy += 210 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    });
    this.debris = this.debris.filter((particle) => particle.age < particle.duration);
  }

  maybeDropItem(target) {
    let itemType = null;
    if (target.type === BLOCK_TYPES.ITEM) {
      itemType = target.item === ITEM_TYPES.RANDOM ? this.randomItemType() : target.item;
    } else if (Math.random() < RANDOM_DROP_RATE) {
      itemType = this.randomItemType();
    }

    if (itemType) {
      this.items.push({
        x: target.x + target.width / 2,
        y: target.y + target.height / 2,
        width: 31,
        height: 16,
        type: itemType,
      });
    }
  }

  randomItemType() {
    const roll = Math.random();
    if (roll < 0.25) return ITEM_TYPES.PADDLE;
    if (roll < 0.50) return ITEM_TYPES.MULTIBALL;
    if (roll < 0.70) return ITEM_TYPES.LARGE_BALL;
    if (roll < 0.90) return ITEM_TYPES.EXPLOSIVE_BALL;
    return ITEM_TYPES.LIFE;
  }

  updateItems(dt) {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      item.y += ITEM_SPEED * dt;
      const rect = {
        x: item.x - item.width / 2,
        y: item.y - item.height / 2,
        width: item.width,
        height: item.height,
      };

      if (this.rectsOverlap(rect, this.paddle)) {
        this.applyItem(item.type);
        this.items.splice(index, 1);
      } else if (item.y - item.height / 2 > BOARD_HEIGHT) {
        this.items.splice(index, 1);
      }
    }
  }

  rectsOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  applyItem(type) {
    if (type === ITEM_TYPES.PADDLE) {
      this.effects.paddleUntil = this.elapsed + EFFECT_DURATIONS.paddle;
      const center = this.paddle.x + this.paddle.width / 2;
      this.paddle.width = LARGE_PADDLE_WIDTH;
      this.paddle.x = clamp(center - this.paddle.width / 2, 0, BOARD_WIDTH - this.paddle.width);
    } else if (type === ITEM_TYPES.LARGE_BALL) {
      this.effects.largeBallUntil = this.elapsed + EFFECT_DURATIONS.largeBall;
      this.balls.forEach((ball) => { ball.radius = LARGE_BALL_RADIUS; });
    } else if (type === ITEM_TYPES.EXPLOSIVE_BALL) {
      this.effects.explosiveBallUntil = this.elapsed + EFFECT_DURATIONS.explosiveBall;
    } else if (type === ITEM_TYPES.MULTIBALL) {
      this.addBall();
    } else if (type === ITEM_TYPES.LIFE) {
      this.lives = Math.min(MAX_LIVES, this.lives + 1);
      this.callbacks.onLivesChange?.(this.lives);
      this.callbacks.onSound?.("life");
      this.emitEffects();
      return;
    }

    this.callbacks.onSound?.("item");
    this.emitEffects();
  }

  addBall() {
    const source = this.balls[0];
    if (!source) return;
    const angle = Math.atan2(source.vy, source.vx) + (Math.random() < 0.5 ? -0.38 : 0.38);
    const speed = Math.hypot(source.vx, source.vy) || BALL_SPEED;
    this.balls.push({
      x: source.x,
      y: source.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: this.isEffectActive("largeBall") ? LARGE_BALL_RADIUS : BALL_RADIUS,
      smashBoosted: this.smashActive,
      smashContacts: new Set(),
      trail: [],
    });
  }

  updateEffects() {
    if (!this.isEffectActive("paddle") && this.paddle.width !== NORMAL_PADDLE_WIDTH) {
      const center = this.paddle.x + this.paddle.width / 2;
      this.paddle.width = NORMAL_PADDLE_WIDTH;
      this.paddle.x = clamp(center - this.paddle.width / 2, 0, BOARD_WIDTH - this.paddle.width);
    }

    const radius = this.isEffectActive("largeBall") ? LARGE_BALL_RADIUS : BALL_RADIUS;
    this.balls.forEach((ball) => { ball.radius = radius; });
    this.emitEffects();
  }

  isEffectActive(name) {
    return this.effects[`${name}Until`] > this.elapsed;
  }

  emitEffects() {
    const active = [];
    if (this.isEffectActive("paddle")) active.push({ label: "WIDE", remaining: this.effects.paddleUntil - this.elapsed });
    if (this.isEffectActive("largeBall")) active.push({ label: "BIG", remaining: this.effects.largeBallUntil - this.elapsed });
    if (this.isEffectActive("explosiveBall")) active.push({ label: "BOOM", remaining: this.effects.explosiveBallUntil - this.elapsed });
    const signature = active.map((effect) => `${effect.label}:${Math.ceil(effect.remaining)}`).join("|");
    if (signature === this.lastEffectSignature) return;
    this.lastEffectSignature = signature;
    this.callbacks.onEffectsChange?.(active);
  }

  loseLife() {
    this.lives -= 1;
    this.callbacks.onLivesChange?.(this.lives);
    this.clearEffects();
    this.callbacks.onSound?.(this.lives > 0 ? "miss" : "gameover");

    if (this.lives <= 0) {
      this.state = "gameover";
      this.callbacks.onStateChange?.(this.state);
      this.callbacks.onGameOver?.();
      return;
    }

    this.resetRound(true);
    this.state = "waiting";
    this.callbacks.onStateChange?.(this.state);
  }

  finishStage() {
    this.state = "cleared";
    this.callbacks.onStateChange?.(this.state);
    this.callbacks.onClear?.(this.elapsed);
  }

  canvasX(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * BOARD_WIDTH;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || this.canvas.width === 0 || this.canvas.height === 0) return;
    ctx.setTransform(this.canvas.width / BOARD_WIDTH, 0, 0, this.canvas.height / BOARD_HEIGHT, 0, 0);
    ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    const background = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
    background.addColorStop(0, "#17233c");
    background.addColorStop(1, "#0b1020");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

    ctx.strokeStyle = "rgba(255,255,255,.035)";
    ctx.lineWidth = 1;
    for (let y = 20; y < BOARD_HEIGHT; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(BOARD_WIDTH, y);
      ctx.stroke();
    }

    this.blocks.forEach((entry) => { if (entry.active || entry.pendingExplosion) this.drawBlock(entry); });
    this.explosionEffects.forEach((effect) => this.drawExplosionEffect(effect));
    this.debris.forEach((particle) => this.drawDebris(particle));
    this.items.forEach((item) => this.drawItem(item));
    this.drawPaddle();
    this.balls.forEach((ball) => this.drawBall(ball));
    this.drawSmashAura();
    this.drawBoardFrame();
  }

  roundedRect(x, y, width, height, radius = 4) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  getBlockImage(entry) {
    let key = entry.type;
    if (entry.type === BLOCK_TYPES.HIT_2 || entry.type === BLOCK_TYPES.HIT_3) {
      key = entry.hp >= 3 ? "hit3" : entry.hp === 2 ? "hit2" : "normal";
    } else if (entry.type === BLOCK_TYPES.ITEM) {
      key = "normal";
    }

    const image = this.blockImages[key];
    return image?.complete && image.naturalWidth > 0 ? image : null;
  }

  drawBlock(entry) {
    const ctx = this.ctx;
    const palettes = {
      [BLOCK_TYPES.NORMAL]: ["#58a6ff", "#2266c2"],
      [BLOCK_TYPES.HIT_2]: ["#ffb84d", "#e47718"],
      [BLOCK_TYPES.HIT_3]: ["#c084fc", "#7137b5"],
      [BLOCK_TYPES.SOLID]: ["#8792a5", "#3f4858"],
      [BLOCK_TYPES.EXPLOSIVE]: ["#ff5f62", "#bd2028"],
      [BLOCK_TYPES.ITEM]: ["#42d6a4", "#12845f"],
    };
    const blockImage = this.getBlockImage(entry);
    if (blockImage) {
      ctx.drawImage(
        blockImage,
        blockImage.naturalWidth * BLOCK_IMAGE_CROP.x,
        blockImage.naturalHeight * BLOCK_IMAGE_CROP.y,
        blockImage.naturalWidth * BLOCK_IMAGE_CROP.width,
        blockImage.naturalHeight * BLOCK_IMAGE_CROP.height,
        entry.x,
        entry.y,
        entry.width,
        entry.height,
      );
    } else {
      const palette = palettes[entry.type];
      const gradient = ctx.createLinearGradient(entry.x, entry.y, entry.x, entry.y + entry.height);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(1, palette[1]);
      this.roundedRect(entry.x, entry.y, entry.width, entry.height, 4);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (entry.blastFlash > 0) {
      const strength = entry.blastFlash / BLOCK_FLASH_DURATION;
      this.roundedRect(entry.x, entry.y, entry.width, entry.height, 4);
      ctx.fillStyle = `rgba(255, 225, 115, ${0.28 + strength * 0.62})`;
      ctx.fill();
    }

    if (entry.pendingExplosion) {
      const remaining = Math.max(0, entry.explosionAt - this.elapsed);
      const pulse = 0.45 + Math.abs(Math.sin(remaining * 46)) * 0.5;
      this.roundedRect(entry.x, entry.y, entry.width, entry.height, 4);
      ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
      ctx.fill();
      ctx.strokeStyle = "#ffec70";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(entry.x, entry.y);
    ctx.strokeStyle = "rgba(255,255,255,.82)";
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.lineWidth = 1.4;

    if (entry.type === BLOCK_TYPES.ITEM) {
      ctx.font = "900 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(18, 32, 55, .85)";
      ctx.strokeText("?", entry.width / 2, entry.height / 2 + .5);
      ctx.fillText("?", entry.width / 2, entry.height / 2 + .5);
    } else if (blockImage) {
      // The image already contains all type and durability details.
    } else if (entry.type === BLOCK_TYPES.HIT_2 || entry.type === BLOCK_TYPES.HIT_3) {
      const lines = entry.hp;
      for (let index = 0; index < lines; index += 1) {
        const x = entry.width / 2 + (index - (lines - 1) / 2) * 5;
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, entry.height - 4);
        ctx.stroke();
      }
    } else if (entry.type === BLOCK_TYPES.SOLID) {
      [[5, 5], [entry.width - 5, 5], [5, entry.height - 5], [entry.width - 5, entry.height - 5]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.beginPath();
      ctx.moveTo(9, entry.height - 4);
      ctx.lineTo(entry.width - 9, 4);
      ctx.stroke();
    } else if (entry.type === BLOCK_TYPES.EXPLOSIVE) {
      ctx.translate(entry.width / 2, entry.height / 2);
      for (let index = 0; index < 8; index += 1) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(3, 0);
        ctx.lineTo(7, 0);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,.42)";
      ctx.fillRect(5, 4, entry.width - 10, 2);
    }
    ctx.restore();
  }

  drawExplosionEffect(effect) {
    const ctx = this.ctx;
    const progress = clamp(effect.age / effect.duration, 0, 1);
    const radius = 8 + progress * 52;
    const alpha = 1 - progress;
    const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, radius);
    gradient.addColorStop(0, `rgba(255,255,225,${0.9 * alpha})`);
    gradient.addColorStop(0.24, `rgba(255,213,74,${0.85 * alpha})`);
    gradient.addColorStop(0.62, `rgba(255,91,45,${0.48 * alpha})`);
    gradient.addColorStop(1, "rgba(210,30,20,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,236,112,${alpha})`;
    ctx.lineWidth = effect.kind === "block" ? 4 : 3;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, radius * 0.82, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`;
    ctx.lineWidth = 2;
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4 + progress * 0.18;
      const inner = radius * 0.28;
      const outer = radius * 0.8;
      ctx.beginPath();
      ctx.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
      ctx.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }

  drawDebris(particle) {
    const progress = clamp(particle.age / particle.duration, 0, 1);
    this.ctx.globalAlpha = 1 - progress;
    this.ctx.fillStyle = particle.color;
    this.ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    this.ctx.globalAlpha = 1;
  }

  drawBoardFrame() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.smashActive ? "rgba(255, 190, 55, .98)" : "rgba(230, 240, 255, .96)";
    ctx.lineWidth = 5;
    ctx.shadowColor = this.smashActive ? "rgba(255, 92, 24, .9)" : "transparent";
    ctx.shadowBlur = this.smashActive ? 12 : 0;
    ctx.strokeRect(2.5, 2.5, BOARD_WIDTH - 5, BOARD_HEIGHT - 5);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(55, 72, 101, .95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, BOARD_WIDTH - 12, BOARD_HEIGHT - 12);
    ctx.restore();
  }

  drawSmashAura() {
    if (!this.smashActive) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255, 100, 20, .035)";
    ctx.fillRect(7, 7, BOARD_WIDTH - 14, BOARD_HEIGHT - 14);

    if (this.smashFlash > 0) {
      const strength = this.smashFlash / 0.45;
      ctx.fillStyle = `rgba(255, 244, 185, ${strength * 0.2})`;
      ctx.fillRect(7, 7, BOARD_WIDTH - 14, BOARD_HEIGHT - 14);
      ctx.fillStyle = `rgba(255, 255, 255, ${strength * 0.95})`;
      ctx.shadowColor = "#ff531f";
      ctx.shadowBlur = 18;
      ctx.font = "1000 34px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SMASH!", BOARD_WIDTH / 2, BOARD_HEIGHT * 0.56);
    }
    ctx.restore();
  }

  drawPaddle() {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(this.paddle.x, this.paddle.y, this.paddle.x, this.paddle.y + this.paddle.height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(1, "#9ed0ff");
    this.roundedRect(this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height, 6);
    ctx.fillStyle = gradient;
    ctx.shadowColor = "rgba(93, 182, 255, .75)";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawBall(ball) {
    const ctx = this.ctx;
    if (this.smashActive && ball.trail?.length) {
      ball.trail.forEach((point, index) => {
        const alpha = ((index + 1) / ball.trail.length) * 0.34;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.radius * (0.45 + index / ball.trail.length * 0.45), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 190, 45, ${alpha})`;
        ctx.fill();
      });
    }
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.smashActive ? "#fff7ad" : this.isEffectActive("explosiveBall") ? "#ff754f" : "#ffffff";
    ctx.shadowColor = this.smashActive ? "#ff7a18" : this.isEffectActive("explosiveBall") ? "#ff3b20" : "#75c9ff";
    ctx.shadowBlur = this.smashActive ? 18 : this.isEffectActive("explosiveBall") ? 13 : 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawItem(item) {
    const ctx = this.ctx;
    const x = item.x - item.width / 2;
    const y = item.y - item.height / 2;
    const image = this.itemImages[item.type];
    if (image?.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x, y, item.width, item.height);
      return;
    }
    this.roundedRect(x, y, item.width, item.height, 6);
    ctx.fillStyle = item.type === ITEM_TYPES.LIFE ? "#e84259" : "#f8d44c";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.stroke();
    ctx.fillStyle = item.type === ITEM_TYPES.LIFE ? "#fff" : "#172033";
    ctx.font = "900 7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ITEM_LABELS[item.type] || "ITEM", item.x, item.y + .5);
  }
}

