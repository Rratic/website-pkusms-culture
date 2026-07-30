const BOARD = {
  x: 42,
  y: 64,
  size: 470,
};
const PIECE_SIZE = 100;
const WORKSPACE = {
  width: 1000,
  height: 690,
};
const DIAL = {
  radius: 38,
  handleRadius: 9,
  hitRadius: 16,
};
const MOVE_STEP = 4;
const ROTATE_STEP = Math.PI / 180;
const EPSILON = 0.01;
const DIRECTION_EPSILON = 0.000001;
const BOARD_WALL_THICKNESS = 18;

const libraryLevel = {
  id: "library",
  blocks: [
    {
      id: "library-intro",
      type: "text",
      kicker: "library",
      title: "智华楼一楼图书角",
      src: new URL("./content/intro.html", import.meta.url),
    },
    {
      id: "library-packing",
      type: "canvas",
      title: "书架",
      caption: "拖动方块移动；选中方块后，拖动圆盘指针旋转。",
      width: WORKSPACE.width,
      height: WORKSPACE.height,
      boxTexture: new URL(`../../assets/images/bookbox.jpg`, import.meta.url),
      bookTextures: Array.from({ length: 17 }, (v, i) => new URL(`../../assets/images/book${i + 1}.png`, import.meta.url)),
      createController: createPackingController,
    },
    {
      id: "library-complete-story",
      type: "text",
      requires: ["library-packing"],
      src: new URL("./content/complete.html", import.meta.url),
    },
    {
      id: "library-exit",
      type: "actions",
      requires: ["library-packing"],
      actions: [{ label: "前往地下室", target: "placeholder" }],
    },
  ],
};

function createPackingController(options) {
  return new LibraryPackingController(options);
}

class LibraryPackingController {
  constructor({ config, canvas, caption, stateBadge, onSolved }) {
    this.config = config;
    this.canvas = canvas;
    this.caption = caption;
    this.stateBadge = stateBadge;
    this.onSolved = onSolved;
    this.ctx = canvas.getContext("2d");
    this.pieces = createPieces();
    this.selectedIndex = -1;
    this.activeMode = "idle";
    this.dragOffset = { x: 0, y: 0 };
    this.lastPointerAngle = 0;
    this.blockedUntil = 0;
    this.blockedTimer = 0;
    this.solved = false;
    this.handleTextureLoad = () => this.draw();
    this.boxTexture = null;
    if (config.boxTexture) {
      this.boxTexture = new Image();
      this.boxTexture.decoding = "async";
      this.boxTexture.addEventListener("load", this.handleTextureLoad);
      this.boxTexture.src = config.boxTexture.href || String(config.boxTexture);
    }
    this.pieceTextures = (config.bookTextures || []).map((source) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", this.handleTextureLoad);
      image.src = source.href || String(source);
      return image;
    });
    this.handleResize = () => {
      this.resizeBuffer();
      this.draw();
    };
    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);

    this.resizeBuffer();
    this.bindEvents();
    this.draw();
  }

  resizeBuffer() {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.config.width * ratio);
    this.canvas.height = Math.round(this.config.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("resize", this.handleResize);
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("resize", this.handleResize);
    window.clearTimeout(this.blockedTimer);
    this.boxTexture?.removeEventListener("load", this.handleTextureLoad);
    this.pieceTextures.forEach((image) => {
      image.removeEventListener("load", this.handleTextureLoad);
    });
  }

  onPointerDown(event) {
    event.preventDefault();
    const point = this.getCanvasPoint(event);

    if (this.selectedIndex >= 0 && this.pointHitsDial(point)) {
      this.activeMode = "rotate";
      this.lastPointerAngle = angleBetween(this.pieces[this.selectedIndex], point);
      this.canvas.setPointerCapture?.(event.pointerId);
      this.draw();
      return;
    }

    const index = this.findPieceAt(point);
    this.selectedIndex = index;
    this.activeMode = index >= 0 ? "move" : "idle";

    if (index >= 0) {
      const piece = this.pieces[index];
      this.dragOffset = {
        x: point.x - piece.x,
        y: point.y - piece.y,
      };
      this.canvas.setPointerCapture?.(event.pointerId);
    }

    this.draw();
  }

  onPointerMove(event) {
    if (this.activeMode === "idle" || this.selectedIndex < 0 || this.solved) {
      return;
    }

    event.preventDefault();
    const point = this.getCanvasPoint(event);
    let advanced = false;

    if (this.activeMode === "move") {
      advanced = this.moveSelectedToward(point.x - this.dragOffset.x, point.y - this.dragOffset.y);
    }

    if (this.activeMode === "rotate") {
      const pointerAngle = angleBetween(this.pieces[this.selectedIndex], point);
      const delta = normalizeAngle(pointerAngle - this.lastPointerAngle);
      advanced = this.rotateSelectedBy(delta);
      this.lastPointerAngle = pointerAngle;
    }

    if (!advanced) {
      this.showBlockedFeedback();
    }

    this.draw();
    this.checkSolved();
  }

  showBlockedFeedback() {
    this.blockedUntil = performance.now() + 180;
    window.clearTimeout(this.blockedTimer);
    this.blockedTimer = window.setTimeout(() => this.draw(), 190);
  }

  onPointerUp(event) {
    if (this.activeMode === "idle") {
      return;
    }

    this.canvas.releasePointerCapture?.(event.pointerId);
    this.activeMode = "idle";
    this.draw();
    this.checkSolved();
  }

  moveSelectedToward(targetX, targetY) {
    const piece = this.pieces[this.selectedIndex];
    const dx = targetX - piece.x;
    const dy = targetY - piece.y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MOVE_STEP));
    const stepX = dx / steps;
    const stepY = dy / steps;
    let moved = false;

    for (let step = 0; step < steps; step += 1) {
      const combinedCandidate = {
        ...piece,
        x: piece.x + stepX,
        y: piece.y + stepY,
      };

      if (this.isCandidateLegal(this.selectedIndex, combinedCandidate)) {
        piece.x = combinedCandidate.x;
        piece.y = combinedCandidate.y;
        moved = true;
        continue;
      }

      if (!this.slideSelectedBy(stepX, stepY, combinedCandidate)) {
        break;
      }

      moved = true;
    }

    return moved;
  }

  slideSelectedBy(dx, dy, blockedCandidate) {
    const directions = this.getSlideDirections(this.selectedIndex, blockedCandidate, dx, dy);

    for (const direction of directions) {
      if (this.moveSelectedAlong(direction, direction.distance)) {
        return true;
      }
    }

    return false;
  }

  getSlideDirections(index, blockedCandidate, dx, dy) {
    const intentLength = Math.hypot(dx, dy);
    if (intentLength <= EPSILON) {
      return [];
    }

    const piece = this.pieces[index];
    const candidateCorners = getCorners(blockedCandidate);
    const angles = [0, Math.PI / 2, piece.angle, piece.angle + Math.PI / 2];

    for (let otherIndex = 0; otherIndex < this.pieces.length; otherIndex += 1) {
      if (
        otherIndex !== index &&
        polygonsOverlap(candidateCorners, getCorners(this.pieces[otherIndex]))
      ) {
        angles.push(this.pieces[otherIndex].angle, this.pieces[otherIndex].angle + Math.PI / 2);
      }
    }

    const axes = [];
    for (const angle of angles) {
      const axis = { x: Math.cos(angle), y: Math.sin(angle) };
      if (
        !axes.some(
          (existing) => Math.abs(dotProduct(existing, axis)) > 1 - DIRECTION_EPSILON,
        )
      ) {
        axes.push(axis);
      }
    }

    return axes
      .map((axis) => {
        const projection = dx * axis.x + dy * axis.y;
        const sign = projection < 0 ? -1 : 1;

        return {
          x: axis.x * sign,
          y: axis.y * sign,
          distance: Math.abs(projection),
          alignment: Math.abs(projection) / intentLength,
        };
      })
      .filter((direction) => direction.distance > EPSILON)
      .sort((first, second) => second.alignment - first.alignment);
  }

  moveSelectedAlong(direction, distance) {
    const piece = this.pieces[this.selectedIndex];
    const candidateAt = (amount) => ({
      ...piece,
      x: piece.x + direction.x * amount,
      y: piece.y + direction.y * amount,
    });

    if (this.isCandidateLegal(this.selectedIndex, candidateAt(distance))) {
      const candidate = candidateAt(distance);
      piece.x = candidate.x;
      piece.y = candidate.y;
      return true;
    }

    let legalDistance = 0;
    let blockedDistance = distance;
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const middle = (legalDistance + blockedDistance) / 2;
      if (this.isCandidateLegal(this.selectedIndex, candidateAt(middle))) {
        legalDistance = middle;
      } else {
        blockedDistance = middle;
      }
    }

    if (legalDistance <= EPSILON) {
      return false;
    }

    const candidate = candidateAt(legalDistance);
    piece.x = candidate.x;
    piece.y = candidate.y;
    return true;
  }

  rotateSelectedBy(delta) {
    if (Math.abs(delta) < 0.0001) {
      return true;
    }

    const piece = this.pieces[this.selectedIndex];
    const direction = Math.sign(delta);
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / ROTATE_STEP));
    const stepDelta = direction * Math.abs(delta / steps);
    let rotated = false;

    for (let step = 0; step < steps; step += 1) {
      const candidate = {
        ...piece,
        angle: normalizeAngle(piece.angle + stepDelta),
      };

      if (!this.isCandidateLegal(this.selectedIndex, candidate)) {
        break;
      }

      piece.angle = candidate.angle;
      rotated = true;
    }

    return rotated;
  }

  isCandidateLegal(index, candidate) {
    const candidateCorners = getCorners(candidate);

    if (getBoardWalls().some((wall) => polygonsOverlap(candidateCorners, wall))) {
      return false;
    }

    for (let otherIndex = 0; otherIndex < this.pieces.length; otherIndex += 1) {
      if (otherIndex === index) {
        continue;
      }

      if (polygonsOverlap(candidateCorners, getCorners(this.pieces[otherIndex]))) {
        return false;
      }
    }

    return true;
  }

  getCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.config.width,
      y: ((event.clientY - rect.top) / rect.height) * this.config.height,
    };
  }

  findPieceAt(point) {
    for (let index = this.pieces.length - 1; index >= 0; index -= 1) {
      if (pointInPiece(point, this.pieces[index])) {
        return index;
      }
    }

    return -1;
  }

  pointHitsDial(point) {
    const piece = this.pieces[this.selectedIndex];
    const handle = getDialHandle(piece);
    const handleDistance = distance(point, handle);
    const ringDistance = Math.abs(distance(point, piece) - DIAL.radius);

    return handleDistance <= DIAL.hitRadius || ringDistance <= 9;
  }

  checkSolved() {
    if (this.solved || !this.pieces.every(isPieceInsideBoard)) {
      return;
    }

    for (let first = 0; first < this.pieces.length; first += 1) {
      for (let second = first + 1; second < this.pieces.length; second += 1) {
        if (polygonsOverlap(getCorners(this.pieces[first]), getCorners(this.pieces[second]))) {
          return;
        }
      }
    }

    this.solved = true;
    this.stateBadge.textContent = "已完成";
    this.stateBadge.classList.add("is-solved");
    this.caption.textContent = "书架整理完成。";
    this.draw();
    this.onSolved(this.config.id);
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this.config;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    this.drawBoard();
    this.drawTray();

    this.pieces.forEach((piece, index) => {
      if (index !== this.selectedIndex) {
        this.drawPiece(piece, index);
      }
    });

    if (this.selectedIndex >= 0) {
      this.drawPiece(this.pieces[this.selectedIndex], this.selectedIndex);
      this.drawDial(this.pieces[this.selectedIndex]);
    }
  }

  drawBoard() {
    const ctx = this.ctx;
    const right = BOARD.x + BOARD.size;
    const bottom = BOARD.y + BOARD.size;
    const textureReady = this.boxTexture?.complete && this.boxTexture.naturalWidth > 0;

    ctx.save();
    if (textureReady) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        this.boxTexture,
        BOARD.x - BOARD_WALL_THICKNESS,
        BOARD.y - BOARD_WALL_THICKNESS,
        BOARD.size + BOARD_WALL_THICKNESS,
        BOARD.size + BOARD_WALL_THICKNESS * 2,
      );
    } else {
      ctx.fillStyle = "#fbfcfe";
      ctx.fillRect(BOARD.x, BOARD.y, BOARD.size, BOARD.size);

      ctx.fillStyle = "#1f2937";
      ctx.fillRect(
        BOARD.x - BOARD_WALL_THICKNESS,
        BOARD.y - BOARD_WALL_THICKNESS,
        BOARD.size + BOARD_WALL_THICKNESS,
        BOARD_WALL_THICKNESS,
      );
      ctx.fillRect(
        BOARD.x - BOARD_WALL_THICKNESS,
        BOARD.y,
        BOARD_WALL_THICKNESS,
        BOARD.size,
      );
      ctx.fillRect(
        BOARD.x - BOARD_WALL_THICKNESS,
        bottom,
        BOARD.size + BOARD_WALL_THICKNESS,
        BOARD_WALL_THICKNESS,
      );
    }

    ctx.restore();
  }

  drawTray() {
    const ctx = this.ctx;
    const trayX = 530;
    const trayY = 42;
    const trayWidth = 450;
    const trayHeight = 600;

    ctx.save();
    ctx.fillStyle = "#f6f8fa";
    ctx.fillRect(trayX, trayY, trayWidth, trayHeight);
    ctx.strokeStyle = "#cfd6df";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 6]);
    ctx.strokeRect(trayX, trayY, trayWidth, trayHeight);
    ctx.setLineDash([]);

    ctx.restore();
  }

  drawPiece(piece, index) {
    const ctx = this.ctx;
    const selected = index === this.selectedIndex;
    const blocked = selected && performance.now() < this.blockedUntil;
    const texture = this.pieceTextures.length
      ? this.pieceTextures[index % this.pieceTextures.length]
      : null;
    const half = PIECE_SIZE / 2;

    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.angle);
    ctx.beginPath();
    ctx.rect(-half, -half, PIECE_SIZE, PIECE_SIZE);
    ctx.clip();

    if (texture?.complete && texture.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(texture, -half, -half, PIECE_SIZE, PIECE_SIZE);
    } else {
      ctx.fillStyle = "#2457c5";
      ctx.fillRect(-half, -half, PIECE_SIZE, PIECE_SIZE);
    }

    if (selected) {
      ctx.strokeStyle = blocked ? "#b42318" : "#111827";
      ctx.lineWidth = 4;
      ctx.strokeRect(-half, -half, PIECE_SIZE, PIECE_SIZE);
    }
    ctx.restore();
  }

  drawDial(piece) {
    const ctx = this.ctx;
    const handle = getDialHandle(piece);
    const blocked = performance.now() < this.blockedUntil;

    ctx.save();
    ctx.strokeStyle = blocked ? "#b42318" : "#111827";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(piece.x, piece.y, DIAL.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = blocked ? "#b42318" : "#2457c5";
    ctx.lineWidth = 3;
    line(ctx, piece.x, piece.y, handle.x, handle.y);

    ctx.fillStyle = blocked ? "#b42318" : "#2457c5";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, DIAL.handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function createPieces() {
  const pieces = [];
  const trayStartX = 590;
  const trayStartY = 102;
  const gapX = 110;
  const gapY = 120;

  for (let index = 0; index < 17; index += 1) {
    const column = index % 4;
    const row = Math.floor(index / 4);
    pieces.push({
      x: trayStartX + column * gapX,
      y: trayStartY + row * gapY,
      angle: 0,
    });
  }

  return pieces;
}

function getCorners(piece) {
  const half = PIECE_SIZE / 2;
  const cos = Math.cos(piece.angle);
  const sin = Math.sin(piece.angle);
  const localCorners = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];

  return localCorners.map((corner) => ({
    x: piece.x + corner.x * cos - corner.y * sin,
    y: piece.y + corner.x * sin + corner.y * cos,
  }));
}

function getDialHandle(piece) {
  return {
    x: piece.x + Math.cos(piece.angle) * DIAL.radius,
    y: piece.y + Math.sin(piece.angle) * DIAL.radius,
  };
}

function pointInPiece(point, piece) {
  const dx = point.x - piece.x;
  const dy = point.y - piece.y;
  const cos = Math.cos(-piece.angle);
  const sin = Math.sin(-piece.angle);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const half = PIECE_SIZE / 2;

  return Math.abs(localX) <= half && Math.abs(localY) <= half;
}

function isPieceInsideBoard(piece) {
  return getCorners(piece).every(
    (corner) =>
      corner.x >= BOARD.x - EPSILON &&
      corner.x <= BOARD.x + BOARD.size + EPSILON &&
      corner.y >= BOARD.y - EPSILON &&
      corner.y <= BOARD.y + BOARD.size + EPSILON,
  );
}

function getBoardWalls() {
  const right = BOARD.x + BOARD.size;
  const bottom = BOARD.y + BOARD.size;

  return [
    rectangleCorners(
      BOARD.x - BOARD_WALL_THICKNESS,
      BOARD.y - BOARD_WALL_THICKNESS,
      right,
      BOARD.y,
    ),
    rectangleCorners(
      BOARD.x - BOARD_WALL_THICKNESS,
      BOARD.y,
      BOARD.x,
      bottom,
    ),
    rectangleCorners(
      BOARD.x - BOARD_WALL_THICKNESS,
      bottom,
      right,
      bottom + BOARD_WALL_THICKNESS,
    ),
  ];
}

function rectangleCorners(left, top, right, bottom) {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

function polygonsOverlap(first, second) {
  const axes = [...getAxes(first), ...getAxes(second)];

  return axes.every((axis) => {
    const firstProjection = projectPolygon(first, axis);
    const secondProjection = projectPolygon(second, axis);
    return !(
      firstProjection.max <= secondProjection.min + EPSILON ||
      secondProjection.max <= firstProjection.min + EPSILON
    );
  });
}

function getAxes(polygon) {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const edgeX = next.x - point.x;
    const edgeY = next.y - point.y;
    const length = Math.hypot(edgeX, edgeY) || 1;
    return {
      x: -edgeY / length,
      y: edgeX / length,
    };
  });
}

function projectPolygon(polygon, axis) {
  const values = polygon.map((point) => point.x * axis.x + point.y * axis.y);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function dotProduct(first, second) {
  return first.x * second.x + first.y * second.y;
}

function angleBetween(origin, point) {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export default libraryLevel;
