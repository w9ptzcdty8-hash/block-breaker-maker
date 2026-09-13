import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  FIXED_STEP,
  circleRectCollision,
  clamp,
  reflectFromPaddle,
  resolveCollision,
} from "./physics.js";
import { BLOCK_TYPES, ITEM_TYPES, validateStage } from "./stages.js";

const GRID_MARGIN_X = 6;
const GRID_TOP = 34;
const GRID_CELL_HEIGHT = 23;
const BLOCK_GAP = 3;
const BLOCK_HEIGHT = 18;
const PADDLE_Y = 525;
const NORMAL_PADDLE_WIDTH = 72;
const LARGE_PADDLE_WIDTH = 108;
const BALL_RADIUS = 6;
const LARGE_BALL_RADIUS = 9;
const BALL_SPEED = 280;
const ITEM_SPEED = 110;
const MAX_LIVES = 5;
const RANDOM_DROP_RATE = 0.08;

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
    this.effects = { paddleUntil: 0, largeBallUntil: 0, explosiveBallUntil: 0 };
    this.lastEffectSignature = "";
    this.paddle = { x: (BOARD_WIDTH - NORMAL_PADDLE_WIDTH) / 2, y: PADDLE_Y, width: NORMAL_PADDLE_WIDTH, height: 12 };
    this.animationId = null;
    this.loop = this.loop.bind(this);
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

    this.draw();
    this.animationId = requestAnimationFrame(this.loop);
  }

  launch() {
    if (this.state !== "waiting") return false;
    const ball = this.balls[0];
    const direction = Math.random() < 0.5 ? -1 : 1;
    ball.vx = BALL_SPEED * 0.55 * direction;
    ball.vy = -Math.sqrt(BALL_SPEED * BALL_SPEED - ball.vx * ball.vx);
    this.state = "running";
    this.callbacks.onStateChange?.(this.state);
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
    }];
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

  update(dt) {
    this.elapsed += dt;
    this.callbacks.onTimeChange?.(this.elapsed);
    this.updateEffects();

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
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - ball.radius < 0) {
      ball.x = ball.radius;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ball.radius > BOARD_WIDTH) {
      ball.x = BOARD_WIDTH - ball.radius;
      ball.vx = -Math.abs(ball.vx);
    }

    if (ball.y - ball.radius < 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
    }

    if (ball.vy > 0) {
      const paddleCollision = circleRectCollision(ball, this.paddle);
      if (paddleCollision) {
        reflectFromPaddle(ball, this.paddle);
        this.callbacks.onSound?.("paddle");
      }
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
      this.hitBlock(collisionTarget, this.isEffectActive("explosiveBall"));
    }
  }

  hitBlock(target, explosiveBall) {
    if (target.type === BLOCK_TYPES.SOLID) {
      this.callbacks.onSound?.("hit");
      return;
    }

    const explosionQueue = [];
    const destroyed = this.damageBlock(target, 1, explosionQueue);

    if (explosiveBall) {
      this.damageNeighbors(target.gridX, target.gridY, explosionQueue);
      this.callbacks.onSound?.("explosion");
    } else {
      this.callbacks.onSound?.(destroyed ? "break" : "hit");
    }

    while (explosionQueue.length > 0) {
      const explosive = explosionQueue.shift();
      this.damageNeighbors(explosive.gridX, explosive.gridY, explosionQueue);
      this.callbacks.onSound?.("explosion");
    }

    if (!this.blocks.some((entry) => entry.active && entry.type !== BLOCK_TYPES.SOLID)) {
      this.finishStage();
    }
  }

  damageNeighbors(gridX, gridY, explosionQueue) {
    for (let y = gridY - 1; y <= gridY + 1; y += 1) {
      for (let x = gridX - 1; x <= gridX + 1; x += 1) {
        if (x === gridX && y === gridY) continue;
        const neighbor = this.blockMap.get(`${x},${y}`);
        if (neighbor?.active && neighbor.type !== BLOCK_TYPES.SOLID) {
          this.damageBlock(neighbor, 1, explosionQueue);
        }
      }
    }
  }

  damageBlock(target, damage, explosionQueue) {
    if (!target.active || target.type === BLOCK_TYPES.SOLID) return false;
    target.hp -= damage;
    if (target.hp > 0) return false;

    target.active = false;
    if (target.type === BLOCK_TYPES.EXPLOSIVE && !target.exploded) {
      target.exploded = true;
      explosionQueue.push(target);
    }
    this.maybeDropItem(target);
    return true;
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

    this.blocks.forEach((entry) => { if (entry.active) this.drawBlock(entry); });
    this.items.forEach((item) => this.drawItem(item));
    this.drawPaddle();
    this.balls.forEach((ball) => this.drawBall(ball));
  }

  roundedRect(x, y, width, height, radius = 4) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
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

    ctx.save();
    ctx.translate(entry.x, entry.y);
    ctx.strokeStyle = "rgba(255,255,255,.82)";
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.lineWidth = 1.4;

    if (entry.type === BLOCK_TYPES.HIT_2 || entry.type === BLOCK_TYPES.HIT_3) {
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
    } else if (entry.type === BLOCK_TYPES.ITEM) {
      ctx.font = "900 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", entry.width / 2, entry.height / 2 + .5);
    } else {
      ctx.fillStyle = "rgba(255,255,255,.42)";
      ctx.fillRect(5, 4, entry.width - 10, 2);
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
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.isEffectActive("explosiveBall") ? "#ff754f" : "#ffffff";
    ctx.shadowColor = this.isEffectActive("explosiveBall") ? "#ff3b20" : "#75c9ff";
    ctx.shadowBlur = this.isEffectActive("explosiveBall") ? 13 : 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawItem(item) {
    const ctx = this.ctx;
    const x = item.x - item.width / 2;
    const y = item.y - item.height / 2;
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
