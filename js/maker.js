import { BLOCK_TYPES, ITEM_TYPES, STAGE_SCHEMA_VERSION, validateStage } from "./stages.js";

export const MAKER_COLUMNS = 10;
export const MAKER_ROWS = 12;
export const MAKER_MAX_BLOCKS = 80;
const HISTORY_LIMIT = 50;

const TOOL_DEFINITIONS = Object.freeze([
  { type: BLOCK_TYPES.NORMAL, label: "1Hit" },
  { type: BLOCK_TYPES.HIT_2, label: "2Hit" },
  { type: BLOCK_TYPES.HIT_3, label: "3Hit" },
  { type: BLOCK_TYPES.SOLID, label: "固定" },
  { type: BLOCK_TYPES.EXPLOSIVE, label: "爆発" },
  { type: BLOCK_TYPES.ITEM, label: "アイテム" },
  { type: "eraser", label: "消す" },
]);

function cloneCells(cells) {
  return cells.map((entry) => entry ? { ...entry } : null);
}

export class StageMaker {
  constructor({
    grid,
    palette,
    itemSettings,
    itemSelect,
    count,
    undoButton,
    redoButton,
    clearButton,
    testButton,
    status,
    onTest,
    confirmClear = () => window.confirm("配置したブロックをすべて消しますか？"),
  }) {
    this.grid = grid;
    this.palette = palette;
    this.itemSettings = itemSettings;
    this.itemSelect = itemSelect;
    this.count = count;
    this.undoButton = undoButton;
    this.redoButton = redoButton;
    this.clearButton = clearButton;
    this.testButton = testButton;
    this.status = status;
    this.onTest = onTest;
    this.confirmClear = confirmClear;
    this.cells = Array(MAKER_COLUMNS * MAKER_ROWS).fill(null);
    this.selectedTool = BLOCK_TYPES.NORMAL;
    this.selectedItem = ITEM_TYPES.RANDOM;
    this.history = [];
    this.future = [];
    this.activeStroke = null;
    this.name = "MY STAGE 0001";
    this.build();
    this.bindEvents();
    this.render();
  }

  build() {
    const cellFragment = document.createDocumentFragment();
    for (let index = 0; index < this.cells.length; index += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "maker-cell";
      cell.dataset.index = String(index);
      cell.setAttribute("aria-label", this.cellLabel(index));
      cellFragment.append(cell);
    }
    this.grid.replaceChildren(cellFragment);

    const toolFragment = document.createDocumentFragment();
    TOOL_DEFINITIONS.forEach((tool) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "maker-tool";
      button.dataset.tool = tool.type;
      button.innerHTML = `<span class="maker-tool-preview" data-tool="${tool.type}"></span><strong>${tool.label}</strong>`;
      toolFragment.append(button);
    });
    this.palette.replaceChildren(toolFragment);
  }

  bindEvents() {
    this.palette.addEventListener("click", (event) => {
      const button = event.target.closest(".maker-tool");
      if (!button) return;
      this.selectedTool = button.dataset.tool;
      this.renderControls();
    });

    this.itemSelect.addEventListener("change", () => {
      this.selectedItem = this.itemSelect.value;
    });

    this.undoButton.addEventListener("click", () => this.undo());
    this.redoButton.addEventListener("click", () => this.redo());
    this.clearButton.addEventListener("click", () => this.clear());
    this.testButton.addEventListener("click", () => {
      const stage = this.createStage();
      if (stage) this.onTest?.(stage);
    });

    this.grid.addEventListener("pointerdown", (event) => this.startStroke(event));
    this.grid.addEventListener("pointermove", (event) => this.moveStroke(event));
    this.grid.addEventListener("pointerup", (event) => this.endStroke(event));
    this.grid.addEventListener("pointercancel", (event) => this.endStroke(event, true));
    this.grid.addEventListener("selectstart", (event) => event.preventDefault());
    this.grid.addEventListener("dragstart", (event) => event.preventDefault());
  }

  startStroke(event) {
    if (this.activeStroke) return;
    const index = this.indexFromPoint(event.clientX, event.clientY);
    if (index < 0) return;
    this.activeStroke = {
      pointerId: event.pointerId,
      before: cloneCells(this.cells),
      changed: false,
      lastIndex: -1,
    };
    this.grid.setPointerCapture?.(event.pointerId);
    this.applyAt(index);
    event.preventDefault();
  }

  moveStroke(event) {
    if (!this.activeStroke || this.activeStroke.pointerId !== event.pointerId) return;
    const index = this.indexFromPoint(event.clientX, event.clientY);
    if (index >= 0) this.applyAt(index);
    event.preventDefault();
  }

  endStroke(event, cancelled = false) {
    if (!this.activeStroke || this.activeStroke.pointerId !== event.pointerId) return;
    const stroke = this.activeStroke;
    this.activeStroke = null;
    if (this.grid.hasPointerCapture?.(event.pointerId)) this.grid.releasePointerCapture(event.pointerId);
    if (cancelled) {
      this.cells = stroke.before;
      this.render();
      return;
    }
    if (stroke.changed) {
      this.history.push(stroke.before);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.future = [];
      this.render();
    }
  }

  indexFromPoint(clientX, clientY) {
    const rect = this.grid.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return -1;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return -1;
    const column = Math.min(MAKER_COLUMNS - 1, Math.floor(x / rect.width * MAKER_COLUMNS));
    const row = Math.min(MAKER_ROWS - 1, Math.floor(y / rect.height * MAKER_ROWS));
    return row * MAKER_COLUMNS + column;
  }

  applyAt(index) {
    const stroke = this.activeStroke;
    if (!stroke || stroke.lastIndex === index) return;
    stroke.lastIndex = index;
    const current = this.cells[index];

    if (this.selectedTool === "eraser") {
      if (!current) return;
      this.cells[index] = null;
    } else {
      const next = {
        type: this.selectedTool,
        ...(this.selectedTool === BLOCK_TYPES.ITEM ? { item: this.selectedItem } : {}),
      };
      if (!current && this.blockCount() >= MAKER_MAX_BLOCKS) {
        this.setStatus(`配置上限は${MAKER_MAX_BLOCKS}個です`, true);
        return;
      }
      if (current?.type === next.type && current?.item === next.item) return;
      this.cells[index] = next;
    }

    stroke.changed = true;
    this.setStatus("ブロックを選んで盤面をなぞれます");
    this.renderCell(index);
    this.renderControls();
  }

  undo() {
    if (this.history.length === 0) return;
    this.future.push(cloneCells(this.cells));
    this.cells = this.history.pop();
    this.render();
  }

  redo() {
    if (this.future.length === 0) return;
    this.history.push(cloneCells(this.cells));
    this.cells = this.future.pop();
    this.render();
  }

  clear() {
    if (this.blockCount() === 0 || !this.confirmClear()) return;
    this.history.push(cloneCells(this.cells));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
    this.cells = Array(this.cells.length).fill(null);
    this.render();
  }

  blockCount() {
    return this.cells.reduce((total, entry) => total + (entry ? 1 : 0), 0);
  }

  hasBreakableBlock() {
    return this.cells.some((entry) => entry && entry.type !== BLOCK_TYPES.SOLID);
  }

  createStage() {
    if (!this.hasBreakableBlock()) {
      this.setStatus("破壊できるブロックを1個以上置いてください", true);
      return null;
    }

    const blocks = [];
    this.cells.forEach((entry, index) => {
      if (!entry) return;
      blocks.push({
        x: index % MAKER_COLUMNS,
        y: Math.floor(index / MAKER_COLUMNS),
        type: entry.type,
        ...(entry.type === BLOCK_TYPES.ITEM ? { item: entry.item } : {}),
      });
    });

    const stage = {
      schemaVersion: STAGE_SCHEMA_VERSION,
      id: "maker-session-stage",
      title: this.name,
      subtitle: "自作ステージ・テストプレイ",
      grid: { columns: MAKER_COLUMNS, rows: MAKER_ROWS },
      blocks,
    };

    if (!validateStage(stage)) {
      this.setStatus("ステージの内容を確認してください", true);
      return null;
    }
    this.setStatus("テストプレイを開始します");
    return stage;
  }

  cellLabel(index) {
    const column = index % MAKER_COLUMNS + 1;
    const row = Math.floor(index / MAKER_COLUMNS) + 1;
    const entry = this.cells[index];
    return `${row}行${column}列：${entry ? entry.type : "空"}`;
  }

  renderCell(index) {
    const cell = this.grid.children[index];
    const entry = this.cells[index];
    if (!cell) return;
    if (entry) {
      cell.dataset.type = entry.type;
      if (entry.item) cell.dataset.item = entry.item;
      else delete cell.dataset.item;
    } else {
      delete cell.dataset.type;
      delete cell.dataset.item;
    }
    cell.setAttribute("aria-label", this.cellLabel(index));
  }

  renderControls() {
    this.palette.querySelectorAll(".maker-tool").forEach((button) => {
      const selected = button.dataset.tool === this.selectedTool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    this.itemSettings.classList.toggle("hidden", this.selectedTool !== BLOCK_TYPES.ITEM);
    this.itemSelect.value = this.selectedItem;
    this.undoButton.disabled = this.history.length === 0;
    this.redoButton.disabled = this.future.length === 0;
    this.clearButton.disabled = this.blockCount() === 0;
    this.testButton.disabled = !this.hasBreakableBlock();
    this.count.textContent = `${this.blockCount()} / ${MAKER_MAX_BLOCKS}`;
    if (!this.status.textContent) this.setStatus("ブロックを選んで盤面をなぞれます");
  }

  setStatus(message, error = false) {
    this.status.textContent = message;
    this.status.classList.toggle("error", error);
  }

  render() {
    this.cells.forEach((_, index) => this.renderCell(index));
    this.renderControls();
  }
}
