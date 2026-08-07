import {
  canvasPointFromEvent,
  resizeCanvasBuffer,
} from "../canvas-utils.js";

const CELL_SIZE = 28;
const MAX_MAP_SIZE = 100;
const MINE_MAP_CELL = Object.freeze({
  unused: 0,
  hidden: 1,
  mine: 2,
  clue: 3,
});
const SYMBOL_TO_CELL = Object.freeze({
  " ": MINE_MAP_CELL.unused,
  "?": MINE_MAP_CELL.hidden,
  "*": MINE_MAP_CELL.mine,
  ".": MINE_MAP_CELL.clue,
});

const VIEWPORT = {
  width: 784,
  height: 560,
};

const DRAG_THRESHOLD = 6;

const mines = {
  id: "mines",
  blocks: [
    {
      type: "text",
      kicker: true,
      title: "扫雷",
      src: new URL("./content/intro.html", import.meta.url),
    },
    {
      type: "canvas",
      title: "扫雷",
      caption: "左键揭开，右键插旗；单击已揭开的数字展开相邻格。",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      mapSrc: new URL("./mines.json", import.meta.url),
      createController: createMinesweeperController,
    },
  ],
};

function createMinesweeperController(options) {
  return new MinesweeperLogicController(options);
}

class MinesweeperLogicController {
  constructor({ config, canvas, onSolved }) {
    this.config = config;
    this.canvas = canvas;
    this.onSolved = onSolved;
    this.ctx = canvas.getContext("2d");
    this.board = { columns: 0, rows: 0, cellSize: CELL_SIZE };
    this.pointer = null;
    this.ready = false;
    this.loadError = "";
    this.destroyed = false;
    this.solved = false;
    this.exploded = false;
    this.explodedCell = null;

    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.handleContextMenu = (event) => this.onContextMenu(event);
    this.handleKeyDown = (event) => this.onKeyDown(event);
    this.handleResize = () => {
      resizeCanvasBuffer(
        this.canvas,
        this.ctx,
        this.config.width,
        this.config.height,
      );
      this.draw();
    };

    this.canvas.style.cursor = "default";
    this.canvas.style.touchAction = "none";
    resizeCanvasBuffer(
      this.canvas,
      this.ctx,
      this.config.width,
      this.config.height,
    );
    this.bindEvents();
    this.updateStatus();
    this.draw();
    void this.loadMap();
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
    this.canvas.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("resize", this.handleResize);
  }

  destroy() {
    this.destroyed = true;
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("resize", this.handleResize);
  }

  async loadMap() {
    try {
      const response = await fetch(this.config.mapSrc, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const mapData = parseMineMapFile(await response.json());
      if (this.destroyed) {
        return;
      }
      this.mapData = mapData;
      this.board = {
        columns: mapData.width,
        rows: mapData.height,
        cellSize: CELL_SIZE,
      };
      if (
        this.board.columns * this.board.cellSize !== this.config.width ||
        this.board.rows * this.board.cellSize !== this.config.height
      ) {
        throw new Error("地图尺寸与画布尺寸不一致");
      }
      this.ready = true;
      this.resetBoard();
      this.updateStatus();
      this.draw();
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      this.loadError = error instanceof Error ? error.message : "未知错误";
      this.updateStatus();
      this.draw();
    }
  }

  resetBoard() {
    this.cells = createBoard(this.mapData);
    this.solved = false;
    this.exploded = false;
    this.explodedCell = null;
    this.revealedSafe = 0;
    this.flagCount = 0;
    this.mineCount = this.cells.reduce(
      (total, cell) => total + (cell.mine ? 1 : 0),
      0,
    );
    this.safeCount = this.cells.reduce(
      (total, cell) => total + (cell.active && !cell.mine ? 1 : 0),
      0,
    );

    this.cells.forEach((cell) => {
      if (cell.active && !cell.mine && cell.revealed) {
        this.revealedSafe += 1;
      }
    });
  }

  onPointerDown(event) {
    if (!this.ready || event.button === 2) {
      return;
    }

    event.preventDefault();
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    this.pointer = {
      id: event.pointerId,
      start: point,
      dragged: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const totalDistance = Math.hypot(
      point.x - this.pointer.start.x,
      point.y - this.pointer.start.y,
    );

    if (totalDistance >= DRAG_THRESHOLD) {
      this.pointer.dragged = true;
    }

  }

  onPointerUp(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) {
      return;
    }

    event.preventDefault();
    this.canvas.releasePointerCapture?.(event.pointerId);
    const wasDragged = this.pointer.dragged;
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    this.pointer = null;

    if (!wasDragged && event.button === 0) {
      if (this.exploded) {
        this.resetBoard();
        this.updateStatus();
        this.draw();
        return;
      }
      this.revealAtPoint(point);
    }
  }

  onContextMenu(event) {
    event.preventDefault();
    if (!this.ready || this.exploded || this.solved) {
      return;
    }

    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const position = this.pointToCell(point);
    if (!position) {
      return;
    }

    const cell = this.getCell(position.column, position.row);
    if (cell.active && !cell.revealed) {
      cell.flagged = !cell.flagged;
      this.flagCount += cell.flagged ? 1 : -1;
      this.checkSolved();
      this.updateStatus();
      this.draw();
    }
  }

  onKeyDown(event) {
    if (event.key.toLowerCase() === "r" && this.ready && !this.solved) {
      event.preventDefault();
      this.resetBoard();
      this.updateStatus();
      this.draw();
    }
  }

  revealAtPoint(point) {
    if (!this.ready || this.solved) {
      return;
    }

    const position = this.pointToCell(point);
    if (!position) {
      return;
    }

    const cell = this.getCell(position.column, position.row);
    if (!cell.active || cell.flagged) {
      return;
    }

    if (cell.revealed) {
      this.chordCell(position.column, position.row);
    } else if (cell.mine) {
      this.triggerMine(cell);
    } else {
      this.revealArea(position.column, position.row);
    }

    this.checkSolved();
    this.updateStatus();
    this.draw();
  }

  revealArea(startColumn, startRow) {
    const queue = [[startColumn, startRow]];
    const queued = new Set();

    while (queue.length > 0) {
      const [column, row] = queue.shift();
      const key = `${column},${row}`;
      if (queued.has(key)) {
        continue;
      }
      queued.add(key);

      const cell = this.getCell(column, row);
      if (!cell || !cell.active || cell.mine || cell.flagged || cell.revealed) {
        continue;
      }

      cell.revealed = true;
      this.revealedSafe += 1;

      if (cell.adjacent === 0) {
        this.getNeighbors(column, row).forEach((neighbor) => {
          if (neighbor.cell.active && !neighbor.cell.mine && !neighbor.cell.revealed) {
            queue.push([neighbor.column, neighbor.row]);
          }
        });
      }
    }
  }

  chordCell(column, row) {
    const cell = this.getCell(column, row);
    if (!cell || cell.adjacent === 0) {
      return;
    }

    const neighbors = this.getNeighbors(column, row);
    const adjacentFlags = neighbors.filter((neighbor) => neighbor.cell.flagged).length;
    if (adjacentFlags !== cell.adjacent) {
      return;
    }

    for (const neighbor of neighbors) {
      if (neighbor.cell.flagged || neighbor.cell.revealed) {
        continue;
      }
      if (neighbor.cell.mine) {
        this.triggerMine(neighbor.cell);
        return;
      }
      this.revealArea(neighbor.column, neighbor.row);
    }
  }

  triggerMine(cell) {
    this.exploded = true;
    this.explodedCell = cell;
    this.cells.forEach((candidate) => {
      if (candidate.mine) {
        candidate.revealed = true;
      }
    });
  }

  checkSolved() {
    if (
      this.solved ||
      this.exploded ||
      this.revealedSafe !== this.safeCount ||
      !this.cells.every((cell) => !cell.active || (cell.mine ? cell.flagged : !cell.flagged))
    ) {
      return;
    }

    this.solved = true;
    this.onSolved();
  }

  updateStatus() {
    if (!this.ready) {
      const suffix = this.loadError ? `，地图加载失败：${this.loadError}` : "，正在加载地图";
      this.canvas.setAttribute("aria-label", `${this.config.title}${suffix}`);
      return;
    }
    if (this.solved) {
      this.canvas.setAttribute("aria-label", `${this.config.title}，所有安全格和雷均已确认`);
      return;
    }

    if (this.exploded) {
      this.canvas.setAttribute("aria-label", `${this.config.title}，踩中了雷，单击盘面重新开始`);
      return;
    }

    const remaining = Math.max(0, this.mineCount - this.flagCount);
    this.canvas.setAttribute(
      "aria-label",
      `${this.config.title}，已确认 ${this.revealedSafe}/${this.safeCount} 个安全节点，待标记 ${remaining}`,
    );
  }

  pointToCell(point) {
    const column = Math.floor(point.x / this.board.cellSize);
    const row = Math.floor(point.y / this.board.cellSize);
    if (column < 0 || row < 0 || column >= this.board.columns || row >= this.board.rows) {
      return null;
    }
    return { column, row };
  }

  getCell(column, row) {
    if (column < 0 || row < 0 || column >= this.board.columns || row >= this.board.rows) {
      return null;
    }
    return this.cells[row * this.board.columns + column];
  }

  getNeighbors(column, row) {
    const neighbors = [];
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }
        const neighborColumn = column + offsetX;
        const neighborRow = row + offsetY;
        const cell = this.getCell(neighborColumn, neighborRow);
        if (cell?.active) {
          neighbors.push({ column: neighborColumn, row: neighborRow, cell });
        }
      }
    }
    return neighbors;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.config.width, this.config.height);
    ctx.fillStyle = "#e5e9eb";
    ctx.fillRect(0, 0, this.config.width, this.config.height);

    if (!this.ready) {
      ctx.fillStyle = this.loadError ? "#a85d58" : "#68727a";
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        this.loadError ? "地图加载失败" : "正在加载地图",
        this.config.width / 2,
        this.config.height / 2,
      );
      return;
    }

    this.drawBoardSurface();
    this.drawCells();
  }

  drawBoardSurface() {
    const ctx = this.ctx;
    ctx.fillStyle = "#dce1e3";
    ctx.fillRect(0, 0, this.config.width, this.config.height);
  }

  drawCells() {
    for (let row = 0; row < this.board.rows; row += 1) {
      for (let column = 0; column < this.board.columns; column += 1) {
        this.drawCell(this.getCell(column, row), column, row);
      }
    }
  }

  drawCell(cell, column, row) {
    if (!cell.active) {
      return;
    }
    const ctx = this.ctx;
    const size = this.board.cellSize;
    const x = column * size;
    const y = row * size;

    if (cell.revealed) {
      ctx.fillStyle = cell === this.explodedCell ? "#c9827a" : "#f4f6f6";
      ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
      if (cell.mine) {
        this.drawMine(x + size / 2, y + size / 2, cell === this.explodedCell);
      } else if (cell.adjacent > 0) {
        ctx.fillStyle = numberColor(cell.adjacent);
        ctx.font = "700 16px ui-monospace, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(cell.adjacent), x + size / 2, y + size / 2 + 1);
      }
      return;
    }

    ctx.fillStyle = "#b3bdc1";
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.strokeStyle = "#a0abb0";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2.5, y + 2.5, size - 5, size - 5);

    if (cell.flagged) {
      this.drawFlag(x + size / 2, y + size / 2);
    }
  }

  drawMine(centerX, centerY, exploded) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.strokeStyle = exploded ? "#ffffff" : "#4d575d";
    ctx.fillStyle = exploded ? "#ffffff" : "#4d575d";
    ctx.lineWidth = 2;
    for (let index = 0; index < 4; index += 1) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(9, 0);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFlag(centerX, centerY) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.strokeStyle = "#4d575d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, 9);
    ctx.lineTo(-5, -9);
    ctx.stroke();
    ctx.fillStyle = "#b85c56";
    ctx.beginPath();
    ctx.moveTo(-4, -9);
    ctx.lineTo(8, -4);
    ctx.lineTo(-4, 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

}

function createBoard(mapData) {
  const cells = Array.from(mapData.cells, (value, index) => {
    const column = index % mapData.width;
    const row = Math.floor(index / mapData.width);
    return {
      column,
      row,
      active: value !== MINE_MAP_CELL.unused,
      mine: value === MINE_MAP_CELL.mine,
      adjacent: 0,
      revealed: value === MINE_MAP_CELL.clue,
      flagged: false,
    };
  });

  cells.forEach((cell) => {
    if (cell.mine) {
      return;
    }
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) {
          continue;
        }
        const column = cell.column + offsetX;
        const row = cell.row + offsetY;
        if (
          column >= 0 &&
          row >= 0 &&
          column < mapData.width &&
          row < mapData.height &&
          cells[row * mapData.width + column].mine
        ) {
          cell.adjacent += 1;
        }
      }
    }
  });

  return cells;
}

function parseMineMapFile(value) {
  if (!value || value.type !== "project-111/mines-map" || value.version !== 1) {
    throw new Error("不是可识别的扫雷地图文件。");
  }
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    throw new Error("地图没有有效行。");
  }

  const width = Number(value.width);
  const height = Number(value.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_MAP_SIZE ||
    height > MAX_MAP_SIZE ||
    value.rows.length !== height
  ) {
    throw new Error("地图尺寸无效。");
  }

  const cells = new Uint8Array(width * height);
  value.rows.forEach((row, y) => {
    if (typeof row !== "string" || row.length !== width) {
      throw new Error(`第 ${y + 1} 行的宽度不正确。`);
    }
    Array.from(row).forEach((symbol, x) => {
      if (!(symbol in SYMBOL_TO_CELL)) {
        throw new Error(`地图包含未知符号“${symbol}”。`);
      }
      cells[y * width + x] = SYMBOL_TO_CELL[symbol];
    });
  });

  return { width, height, cells };
}

function numberColor(value) {
  return ["#4d575d", "#55719b", "#557f68", "#a15f5b", "#766795", "#947252", "#4f7d80", "#555e64", "#7b8388"][value];
}

export default mines;
