import {
  canvasPointFromEvent,
  normalizeAngle,
  resizeCanvasBuffer,
} from "../canvas-utils.js";

const VIEWPORT = {
  width: 920,
  height: 680,
};

const TILING = {
  sides: 7,
  verticesAtCorner: 3,
  worldDepth: 3,
  sightDepth: 3,
  circleRadius: 20,
};

const GLOBAL_BUCKET_SIZE = 0.02;
const GLOBAL_CENTER_EPSILON = 0.006;

const DISK = {
  x: VIEWPORT.width / 2,
  y: VIEWPORT.height / 2 + 8,
  radius: 292,
};

const COLORS = {
  page: "#f5f2eb",
  disk: "#e6e9e5",
  tile: "#d2ddd7",
  tileDark: "#b9cac1",
  edge: "#667a72",
  current: "#2b7a78",
  currentEdge: "#123f3e",
  boundary: "#e2af35",
  boundaryEdge: "#76510a",
  center: "#c94f45",
  centerEdge: "#6f1f1a",
  fog: "rgba(19, 29, 33, 0.42)",
  muted: "#657178",
};

const hyperbolicLevel = {
  id: "hyperbolic",
  blocks: [
    {
      type: "text",
      kicker: true,
      title: "双曲圆盘",
      src: new URL("./content/intro.html", import.meta.url),
    },
    {
      type: "canvas",
      title: "寻找双曲圆心",
      caption: "点击相邻七边形移动；拖动画面选择移动方向。",
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      createController: createHyperRogueController,
    },
  ],
};

function createHyperRogueController(options) {
  return new HyperRogueController(options);
}

class HyperRogueController {
  constructor({ config, canvas, onSolved }) {
    this.config = config;
    this.canvas = canvas;
    this.onSolved = onSolved;
    this.ctx = canvas.getContext("2d");

    this.world = createTiling(TILING.worldDepth);
    this.targetId = 0;
    this.currentId = chooseStartTile(this.world, this.targetId);
    this.targetDistances = graphDistances(this.world, this.targetId);
    this.camera = { ...this.world.tiles[this.currentId].center };
    this.moves = 0;
    this.solved = false;
    this.animating = false;
    this.animationFrame = 0;
    this.drag = null;
    this.dragOffset = { x: 0, y: 0 };
    this.visibleIds = new Set();

    this.handleResize = () => {
      resizeCanvasBuffer(
        this.canvas,
        this.ctx,
        this.config.width,
        this.config.height,
      );
      this.draw();
    };
    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.handlePointerCancel = (event) => this.onPointerCancel(event);

    resizeCanvasBuffer(
      this.canvas,
      this.ctx,
      this.config.width,
      this.config.height,
    );
    this.bindEvents();
    this.refreshVisibility();
    this.draw();
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.canvas.addEventListener("pointermove", this.handlePointerMove);
    this.canvas.addEventListener("pointerup", this.handlePointerUp);
    this.canvas.addEventListener("pointercancel", this.handlePointerCancel);
    window.addEventListener("resize", this.handleResize);
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    window.removeEventListener("resize", this.handleResize);
    window.cancelAnimationFrame(this.animationFrame);
  }

  refreshVisibility(extraCenterId = null) {
    rebuildNeighborhoodGeometry(this.world, this.currentId, TILING.sightDepth);
    ensureNeighborhood(this.world, this.currentId, TILING.sightDepth);
    if (extraCenterId != null) {
      rebuildNeighborhoodGeometry(this.world, extraCenterId, TILING.sightDepth);
      ensureNeighborhood(this.world, extraCenterId, TILING.sightDepth);
    }

    this.targetDistances = graphDistances(this.world, this.targetId);
    this.visibleIds = graphBall(this.world, this.currentId, TILING.sightDepth);
    if (extraCenterId != null) {
      graphBall(this.world, extraCenterId, TILING.sightDepth).forEach((id) => {
        this.visibleIds.add(id);
      });
    }
  }

  onPointerDown(event) {
    if (this.solved || this.animating) {
      return;
    }

    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    this.drag = {
      pointerId: event.pointerId,
      start: point,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId || this.animating) {
      return;
    }

    event.preventDefault();
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const dx = point.x - this.drag.start.x;
    const dy = point.y - this.drag.start.y;
    const length = Math.hypot(dx, dy);
    const scale = length > 34 ? 34 / length : 1;
    this.dragOffset = { x: dx * scale, y: dy * scale };
    this.draw();
  }

  onPointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return;
    }

    event.preventDefault();
    const point = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const dx = point.x - this.drag.start.x;
    const dy = point.y - this.drag.start.y;
    const distance = Math.hypot(dx, dy);
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.drag = null;
    this.dragOffset = { x: 0, y: 0 };

    if (distance >= 24) {
      this.moveTowardScreenDirection(-dx, -dy);
      return;
    }

    this.activateAt(point);
  }

  onPointerCancel(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return;
    }
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.drag = null;
    this.dragOffset = { x: 0, y: 0 };
    this.draw();
  }

  activateAt(point) {
    const currentPoint = this.projectTileCenter(this.currentId);
    if (
      this.currentId === this.targetId &&
      currentPoint &&
      Math.hypot(point.x - currentPoint.x, point.y - currentPoint.y) < 54
    ) {
      this.checkSolved();
      return;
    }

    let selectedId = null;
    let selectedDistance = Infinity;
    for (const neighborId of this.world.tiles[this.currentId].neighbors) {
      if (!this.canEnterTile(neighborId)) {
        continue;
      }
      const center = this.projectTileCenter(neighborId);
      const hitDistance = Math.hypot(point.x - center.x, point.y - center.y);
      if (hitDistance < selectedDistance) {
        selectedDistance = hitDistance;
        selectedId = neighborId;
      }
    }

    if (selectedId != null && selectedDistance < 76) {
      this.moveTo(selectedId);
    }
  }

  moveTowardScreenDirection(x, y) {
    let bestId = null;
    let bestScore = -Infinity;
    const length = Math.hypot(x, y) || 1;
    for (const neighborId of this.world.tiles[this.currentId].neighbors) {
      if (!this.canEnterTile(neighborId)) {
        continue;
      }
      const center = this.projectTileCenter(neighborId);
      const vx = center.x - DISK.x;
      const vy = center.y - DISK.y;
      const vectorLength = Math.hypot(vx, vy) || 1;
      const score = (vx * x + vy * y) / (vectorLength * length);
      if (score > bestScore) {
        bestScore = score;
        bestId = neighborId;
      }
    }

    if (bestId != null) {
      this.moveTo(bestId);
    }
  }

  projectTileCenter(tileId) {
    const transformed = diskTransform(this.world.tiles[tileId].center, this.camera);
    return toCanvasPoint(transformed, this.dragOffset);
  }

  canEnterTile(tileId) {
    return (
      tileId != null &&
      this.targetDistances[tileId] <= TILING.circleRadius
    );
  }

  moveTo(nextId) {
    if (this.solved || this.animating || !this.canEnterTile(nextId)) {
      return;
    }

    const previousId = this.currentId;
    const from = { ...this.camera };
    const to = { ...this.world.tiles[nextId].center };
    this.currentId = nextId;
    this.moves += 1;
    this.animating = true;
    this.refreshVisibility(previousId);
    const startedAt = performance.now();
    const duration = 260;

    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.camera = diskGeodesicInterpolate(from, to, eased);
      this.draw();

      if (progress < 1) {
        this.animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      recenterWorld(this.world, nextId);
      this.camera = { x: 0, y: 0 };
      this.animating = false;
      this.refreshVisibility();
      this.draw();
      this.checkSolved();
    };

    this.animationFrame = window.requestAnimationFrame(tick);
  }

  checkSolved() {
    if (this.solved || this.currentId !== this.targetId || this.animating) {
      return;
    }

    this.solved = true;
    this.canvas.setAttribute("aria-label", `已找到双曲圆心，共移动 ${this.moves} 步`);
    this.draw();
    this.onSolved();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.config.width, this.config.height);
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, this.config.width, this.config.height);

    ctx.save();
    ctx.beginPath();
    ctx.arc(DISK.x, DISK.y, DISK.radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COLORS.disk;
    ctx.fillRect(
      DISK.x - DISK.radius,
      DISK.y - DISK.radius,
      DISK.radius * 2,
      DISK.radius * 2,
    );

    const tiles = Array.from(this.visibleIds, (id) => this.world.tiles[id])
      .filter(
        (tile) =>
          tile && this.targetDistances[tile.id] <= TILING.circleRadius,
      )
      .map((tile) => ({
        tile,
        center: diskTransform(tile.center, this.camera),
      }))
      .sort((first, second) => magnitude(second.center) - magnitude(first.center));

    for (const entry of tiles) {
      this.drawTile(entry.tile, entry.center);
    }

    this.drawSightBoundary();
    ctx.restore();
    this.drawDiskRim();
    this.drawLegend();
  }

  drawTile(tile, transformedCenter) {
    const transformedVertices = tile.vertices.map((point) => diskTransform(point, this.camera));
    if (transformedVertices.every((point) => magnitude(point) > 1.08)) {
      return;
    }

    const center = toCanvasPoint(transformedCenter, this.dragOffset);
    const path = createGeodesicPolygonPath(transformedVertices, this.dragOffset);
    const targetDistance = this.targetDistances[tile.id];

    let fill = usesDarkTileColor(tile.id) ? COLORS.tileDark : COLORS.tile;
    let stroke = COLORS.edge;
    let lineWidth = 1.25;

    if (targetDistance === TILING.circleRadius) {
      fill = COLORS.boundary;
      stroke = COLORS.boundaryEdge;
      lineWidth = 2.2;
    }
    if (tile.id === this.targetId) {
      fill = COLORS.center;
      stroke = COLORS.centerEdge;
      lineWidth = 2.6;
    }
    if (tile.id === this.currentId) {
      fill = this.solved ? COLORS.center : COLORS.current;
      stroke = this.solved ? COLORS.centerEdge : COLORS.currentEdge;
      lineWidth = 3.2;
    }

    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.fill(path);
    ctx.stroke(path);

    if (tile.id === this.currentId) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawSightBoundary() {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      DISK.x + this.dragOffset.x,
      DISK.y + this.dragOffset.y,
      DISK.radius * 0.64,
      DISK.x + this.dragOffset.x,
      DISK.y + this.dragOffset.y,
      DISK.radius,
    );
    gradient.addColorStop(0, "rgba(19, 29, 33, 0)");
    gradient.addColorStop(0.72, "rgba(19, 29, 33, 0.08)");
    gradient.addColorStop(1, COLORS.fog);
    ctx.fillStyle = gradient;
    ctx.fillRect(
      DISK.x - DISK.radius,
      DISK.y - DISK.radius,
      DISK.radius * 2,
      DISK.radius * 2,
    );
  }

  drawDiskRim() {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(DISK.x, DISK.y, DISK.radius, 0, Math.PI * 2);
    ctx.strokeStyle = "#263a40";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(DISK.x, DISK.y, DISK.radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(38, 58, 64, 0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawLegend() {
    const ctx = this.ctx;
    const x = this.config.width - 180;
    const y = this.config.height - 57;
    ctx.save();
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "left";

    ctx.fillStyle = COLORS.boundary;
    ctx.fillRect(x, y, 14, 14);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("圆周", x + 21, y + 12);

    ctx.fillStyle = COLORS.center;
    ctx.fillRect(x + 76, y, 14, 14);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("圆心", x + 97, y + 12);
    ctx.restore();
  }
}

function createTiling(maxDepth) {
  const sides = TILING.sides;
  const circumradius = regularPolygonRadius(sides, TILING.verticesAtCorner);
  const diskVertices = Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides;
    return {
      x: Math.cos(angle) * circumradius,
      y: Math.sin(angle) * circumradius,
    };
  });
  const baseVertices = diskVertices.map(diskToHyperboloid);
  const reflections = baseVertices.map((first, side) =>
    hyperboloidReflection(first, baseVertices[(side + 1) % sides]),
  );
  const symmetries = createPolygonSymmetries(sides);
  const globalBuckets = new Map();
  const world = {
    tiles: [],
    globalBuckets,
    baseVertices,
    reflections,
    symmetries,
  };
  const identity = identityMatrix();
  const root = createTile(0, identity, identity, 0, world);
  world.tiles.push(root);
  addGlobalCenterToBuckets(world, root);
  const queue = [0];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const tile = world.tiles[queue[cursor]];
    if (tile.depth >= maxDepth) {
      continue;
    }
    queue.push(...expandTile(world, tile.id));
  }

  return world;
}

function expandTile(world, tileId) {
  const tile = world.tiles[tileId];
  const createdIds = [];

  for (let side = 0; side < TILING.sides; side += 1) {
    if (tile.neighbors[side] != null) {
      continue;
    }
    const first = tile.vertices[side];
    const second = tile.vertices[(side + 1) % TILING.sides];
    const candidateTransform = multiplyMatrices(
      tile.transform,
      world.reflections[side],
    );
    const candidateGlobalTransform = multiplyMatrices(
      tile.globalTransform,
      world.reflections[side],
    );
    const candidateGlobalCenter = globalCenterFromTransform(candidateGlobalTransform);
    let neighbor = findGlobalTileNear(world, candidateGlobalCenter);
    let alignment = identityMatrix();
    if (neighbor) {
      alignment = findGlobalPolygonAlignment(
        world,
        candidateGlobalTransform,
        neighbor,
      );
      setTileTransform(
        world,
        neighbor,
        multiplyMatrices(candidateTransform, alignment),
      );
    }
    let matchingSide = neighbor ? findMatchingSide(neighbor, first, second) : -1;
    let created = false;

    if (
      neighbor &&
      (matchingSide < 0 ||
        (neighbor.neighbors[matchingSide] != null &&
          neighbor.neighbors[matchingSide] !== tile.id))
    ) {
      matchingSide = neighbor.neighbors.indexOf(tile.id);
      if (matchingSide < 0) {
        neighbor = null;
      }
    }

    if (!neighbor) {
      neighbor = createTile(
        world.tiles.length,
        candidateTransform,
        candidateGlobalTransform,
        tile.depth + 1,
        world,
      );
      world.tiles.push(neighbor);
      createdIds.push(neighbor.id);
      addGlobalCenterToBuckets(world, neighbor);
      matchingSide = findMatchingSide(neighbor, first, second);
      created = true;
    }

    tile.neighbors[side] = neighbor.id;
    if (matchingSide >= 0) {
      neighbor.neighbors[matchingSide] = tile.id;
      if (created) {
        tile.neighborTransforms[side] = world.reflections[side];
        neighbor.neighborTransforms[matchingSide] = world.reflections[side];
      } else {
        const relativeTransform = multiplyMatrices(
          world.reflections[side],
          alignment,
        );
        tile.neighborTransforms[side] = relativeTransform;
        neighbor.neighborTransforms[matchingSide] = lorentzInverse(relativeTransform);
      }
    }
  }

  return createdIds;
}

function ensureNeighborhood(world, centerId, radius) {
  const visited = new Set([centerId]);
  const queue = [{ id: centerId, distance: 0 }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor];
    if (entry.distance >= radius) {
      continue;
    }

    expandTile(world, entry.id);
    for (const neighborId of world.tiles[entry.id].neighbors) {
      if (neighborId == null || visited.has(neighborId)) {
        continue;
      }
      visited.add(neighborId);
      queue.push({ id: neighborId, distance: entry.distance + 1 });
    }
  }
}

function rebuildNeighborhoodGeometry(world, centerId, radius) {
  const visited = new Set([centerId]);
  const queue = [{ id: centerId, distance: 0 }];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor];
    if (entry.distance >= radius) {
      continue;
    }

    const tile = world.tiles[entry.id];
    for (let side = 0; side < TILING.sides; side += 1) {
      const neighborId = tile.neighbors[side];
      if (neighborId == null || visited.has(neighborId)) {
        continue;
      }
      const relativeTransform = tile.neighborTransforms[side];
      if (!relativeTransform) {
        continue;
      }
      const neighbor = world.tiles[neighborId];
      setTileTransform(
        world,
        neighbor,
        multiplyMatrices(tile.transform, relativeTransform),
      );
      visited.add(neighborId);
      queue.push({ id: neighborId, distance: entry.distance + 1 });
    }
  }

}

function recenterWorld(world, centerId) {
  const centerTile = world.tiles[centerId];
  const center = transformHyperboloid(
    centerTile.transform,
    { t: 1, x: 0, y: 0 },
  );
  const boost = lorentzBoostToOrigin(center);
  setTileTransform(
    world,
    centerTile,
    multiplyMatrices(boost, centerTile.transform),
  );
  rebuildNeighborhoodGeometry(world, centerId, TILING.sightDepth);
}

function createTile(id, transform, globalTransform, depth, world) {
  const tile = {
    id,
    transform,
    globalTransform,
    globalCenter: globalCenterFromTransform(globalTransform),
    vertices: [],
    center: { x: 0, y: 0 },
    depth,
    neighbors: Array(TILING.sides).fill(null),
    neighborTransforms: Array(TILING.sides).fill(null),
  };
  setTileTransform(world, tile, transform);
  return tile;
}

function setTileTransform(world, tile, transform) {
  const normalizedTransform = normalizeLorentzMatrix(transform);
  tile.transform = normalizedTransform;
  tile.center = transformDiskCenter(normalizedTransform);
  tile.vertices = world.baseVertices.map((point) =>
    hyperboloidToDisk(transformHyperboloid(normalizedTransform, point)),
  );
}

function globalCenterFromTransform(transform) {
  return {
    t: transform[0],
    x: transform[3],
    y: transform[6],
  };
}

function globalBucketKey(point) {
  return `${Math.round(point.x / GLOBAL_BUCKET_SIZE)},${Math.round(
    point.y / GLOBAL_BUCKET_SIZE,
  )}`;
}

function addGlobalCenterToBuckets(world, tile) {
  const key = globalBucketKey(tile.globalCenter);
  const bucket = world.globalBuckets.get(key) || [];
  bucket.push(tile.id);
  world.globalBuckets.set(key, bucket);
}

function findGlobalTileNear(world, point) {
  const x = Math.round(point.x / GLOBAL_BUCKET_SIZE);
  const y = Math.round(point.y / GLOBAL_BUCKET_SIZE);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = world.globalBuckets.get(`${x + dx},${y + dy}`) || [];
      for (const id of bucket) {
        const center = world.tiles[id].globalCenter;
        if (
          Math.hypot(
            center.t - point.t,
            center.x - point.x,
            center.y - point.y,
          ) < GLOBAL_CENTER_EPSILON
        ) {
          return world.tiles[id];
        }
      }
    }
  }
  return null;
}

function normalizeLorentzMatrix(matrix) {
  let time = [matrix[0], matrix[3], matrix[6]];
  const timeNormSquared = -minkowskiDot(time, time);
  if (!Number.isFinite(timeNormSquared) || timeNormSquared <= 1e-15) {
    return matrix;
  }
  time = scaleVector(time, 1 / Math.sqrt(timeNormSquared));
  if (time[0] < 0) {
    time = scaleVector(time, -1);
  }

  const rawFirstSpace = [matrix[1], matrix[4], matrix[7]];
  let firstSpace = addVectors(
    rawFirstSpace,
    scaleVector(time, minkowskiDot(rawFirstSpace, time)),
  );
  const firstNormSquared = minkowskiDot(firstSpace, firstSpace);
  if (!Number.isFinite(firstNormSquared) || firstNormSquared <= 1e-15) {
    return matrix;
  }
  firstSpace = scaleVector(firstSpace, 1 / Math.sqrt(firstNormSquared));

  const rawSecondSpace = [matrix[2], matrix[5], matrix[8]];
  let secondSpace = addVectors(
    rawSecondSpace,
    scaleVector(time, minkowskiDot(rawSecondSpace, time)),
  );
  secondSpace = addVectors(
    secondSpace,
    scaleVector(firstSpace, -minkowskiDot(secondSpace, firstSpace)),
  );
  const secondNormSquared = minkowskiDot(secondSpace, secondSpace);
  if (!Number.isFinite(secondNormSquared) || secondNormSquared <= 1e-15) {
    return matrix;
  }
  secondSpace = scaleVector(secondSpace, 1 / Math.sqrt(secondNormSquared));

  return [
    time[0], firstSpace[0], secondSpace[0],
    time[1], firstSpace[1], secondSpace[1],
    time[2], firstSpace[2], secondSpace[2],
  ];
}

function minkowskiDot(first, second) {
  return -first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function scaleVector(vector, scale) {
  return vector.map((value) => value * scale);
}

function addVectors(first, second) {
  return first.map((value, index) => value + second[index]);
}

function diskToHyperboloid(point) {
  const denominator = Math.max(1e-15, 1 - point.x * point.x - point.y * point.y);
  return {
    t: (1 + point.x * point.x + point.y * point.y) / denominator,
    x: (2 * point.x) / denominator,
    y: (2 * point.y) / denominator,
  };
}

function hyperboloidToDisk(point) {
  const denominator = Math.max(1e-15, point.t + 1);
  return {
    x: point.x / denominator,
    y: point.y / denominator,
  };
}

function hyperboloidReflection(first, second) {
  const cross = {
    t: first.x * second.y - first.y * second.x,
    x: first.y * second.t - first.t * second.y,
    y: first.t * second.x - first.x * second.t,
  };
  const normal = { t: -cross.t, x: cross.x, y: cross.y };
  const length = Math.sqrt(
    Math.max(1e-15, -normal.t * normal.t + normal.x * normal.x + normal.y * normal.y),
  );
  const unit = {
    t: normal.t / length,
    x: normal.x / length,
    y: normal.y / length,
  };
  const covector = [-unit.t, unit.x, unit.y];
  const vector = [unit.t, unit.x, unit.y];
  const reflection = identityMatrix();

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      reflection[row * 3 + column] -= 2 * vector[row] * covector[column];
    }
  }
  return reflection;
}

function createPolygonSymmetries(sides) {
  const result = [];
  const mirror = [1, 0, 0, 0, -1, 0, 0, 0, 1];
  for (let index = 0; index < sides; index += 1) {
    const angle = (index * Math.PI * 2) / sides;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rotation = [
      1, 0, 0,
      0, cosine, -sine,
      0, sine, cosine,
    ];
    result.push(rotation, multiplyMatrices(rotation, mirror));
  }
  return result;
}

function findGlobalPolygonAlignment(world, candidateTransform, tile) {
  let best = identityMatrix();
  let bestError = Infinity;

  for (const symmetry of world.symmetries) {
    const alignedTransform = multiplyMatrices(candidateTransform, symmetry);
    let error = 0;
    for (let index = 0; index < alignedTransform.length; index += 1) {
      const scale = Math.max(1, Math.abs(tile.globalTransform[index]));
      error = Math.max(
        error,
        Math.abs(alignedTransform[index] - tile.globalTransform[index]) / scale,
      );
    }
    if (error < bestError) {
      best = symmetry;
      bestError = error;
    }
  }

  return best;
}

function identityMatrix() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

function multiplyMatrices(first, second) {
  const result = Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let inner = 0; inner < 3; inner += 1) {
        result[row * 3 + column] +=
          first[row * 3 + inner] * second[inner * 3 + column];
      }
    }
  }
  return result;
}

function transformHyperboloid(matrix, point) {
  const vector = [point.t, point.x, point.y];
  return {
    t: matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    x: matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    y: matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  };
}

function transformDiskCenter(transform) {
  return hyperboloidToDisk(transformHyperboloid(transform, { t: 1, x: 0, y: 0 }));
}

function lorentzInverse(matrix) {
  const signs = [-1, 1, 1];
  const result = Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row * 3 + column] =
        signs[row] * signs[column] * matrix[column * 3 + row];
    }
  }
  return result;
}

function lorentzBoostToOrigin(point) {
  const norm = Math.sqrt(
    Math.max(1e-15, point.t * point.t - point.x * point.x - point.y * point.y),
  );
  const normalized = {
    t: point.t / norm,
    x: point.x / norm,
    y: point.y / norm,
  };
  const denominator = Math.max(1e-15, normalized.t + 1);
  return [
    normalized.t,
    -normalized.x,
    -normalized.y,
    -normalized.x,
    1 + (normalized.x * normalized.x) / denominator,
    (normalized.x * normalized.y) / denominator,
    -normalized.y,
    (normalized.x * normalized.y) / denominator,
    1 + (normalized.y * normalized.y) / denominator,
  ];
}

function regularPolygonRadius(p, q) {
  const coshRadius = 1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q));
  const hyperbolicRadius = Math.acosh(coshRadius);
  return Math.tanh(hyperbolicRadius / 2);
}

function geodesicThrough(first, second) {
  const determinant = first.x * second.y - first.y * second.x;
  if (Math.abs(determinant) < 1e-10) {
    const length = Math.hypot(first.x, first.y) || 1;
    return {
      type: "line",
      dx: first.x / length,
      dy: first.y / length,
    };
  }

  const firstValue = (first.x * first.x + first.y * first.y + 1) / 2;
  const secondValue = (second.x * second.x + second.y * second.y + 1) / 2;
  const cx = (firstValue * second.y - first.y * secondValue) / determinant;
  const cy = (first.x * secondValue - firstValue * second.x) / determinant;
  return {
    type: "circle",
    cx,
    cy,
    radiusSquared: Math.max(0, cx * cx + cy * cy - 1),
  };
}

function findMatchingSide(tile, first, second) {
  for (let side = 0; side < tile.vertices.length; side += 1) {
    const a = tile.vertices[side];
    const b = tile.vertices[(side + 1) % tile.vertices.length];
    if (
      (pointNear(a, first) && pointNear(b, second)) ||
      (pointNear(a, second) && pointNear(b, first))
    ) {
      return side;
    }
  }
  return -1;
}

function pointNear(first, second) {
  return magnitude(diskTransform(first, second)) < 2e-4;
}

function graphDistances(world, startId) {
  const distances = Array(world.tiles.length).fill(Infinity);
  distances[startId] = 0;
  const queue = [startId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const neighborId of world.tiles[id].neighbors) {
      if (neighborId == null || distances[neighborId] !== Infinity) {
        continue;
      }
      distances[neighborId] = distances[id] + 1;
      queue.push(neighborId);
    }
  }
  return distances;
}

function graphBall(world, centerId, radius) {
  const result = new Set([centerId]);
  const queue = [{ id: centerId, distance: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const entry = queue[cursor];
    if (entry.distance >= radius) {
      continue;
    }
    for (const neighborId of world.tiles[entry.id].neighbors) {
      if (neighborId == null || result.has(neighborId)) {
        continue;
      }
      result.add(neighborId);
      queue.push({ id: neighborId, distance: entry.distance + 1 });
    }
  }
  return result;
}

function chooseStartTile(world, targetId) {
  const preferredAngle = -0.18;
  let distances = graphDistances(world, targetId);
  const initialDistance = Math.min(TILING.worldDepth, TILING.circleRadius);
  const candidates = world.tiles.filter(
    (tile) => distances[tile.id] === initialDistance,
  );
  let current = chooseTileNearAngle(candidates, preferredAngle) || world.tiles[targetId];
  recenterWorld(world, current.id);

  while (distances[current.id] < TILING.circleRadius) {
    ensureNeighborhood(world, current.id, TILING.sightDepth);
    distances = graphDistances(world, targetId);
    const localIds = graphBall(world, current.id, TILING.sightDepth);
    const nextDistance = Math.min(
      TILING.circleRadius,
      Math.max(...Array.from(localIds, (id) => distances[id])),
    );
    const outwardTiles = Array.from(localIds, (id) => world.tiles[id]).filter(
      (tile) => distances[tile.id] === nextDistance,
    );
    const next = chooseTileNearAngle(outwardTiles, preferredAngle);
    if (!next) {
      break;
    }
    current = next;
    recenterWorld(world, current.id);
  }

  return current.id;
}

function chooseTileNearAngle(candidates, preferredAngle) {
  let best = null;
  let bestScore = Infinity;
  for (const tile of candidates) {
    const angle = Math.atan2(tile.center.y, tile.center.x);
    const score = Math.abs(normalizeAngle(angle - preferredAngle));
    if (score < bestScore) {
      best = tile;
      bestScore = score;
    }
  }
  return best;
}

function diskTransform(point, camera) {
  const numerator = {
    x: point.x - camera.x,
    y: point.y - camera.y,
  };
  const denominator = {
    x: 1 - camera.x * point.x - camera.y * point.y,
    y: camera.y * point.x - camera.x * point.y,
  };
  return divideComplex(numerator, denominator);
}

function diskInverseTransform(point, camera) {
  const numerator = {
    x: point.x + camera.x,
    y: point.y + camera.y,
  };
  const denominator = {
    x: 1 + camera.x * point.x + camera.y * point.y,
    y: camera.x * point.y - camera.y * point.x,
  };
  return divideComplex(numerator, denominator);
}

function divideComplex(numerator, denominator) {
  const squared = Math.max(1e-15, denominator.x * denominator.x + denominator.y * denominator.y);
  return {
    x: (numerator.x * denominator.x + numerator.y * denominator.y) / squared,
    y: (numerator.y * denominator.x - numerator.x * denominator.y) / squared,
  };
}

function diskGeodesicInterpolate(from, to, amount) {
  const relative = diskTransform(to, from);
  const radius = Math.min(0.999999, magnitude(relative));
  if (radius < 1e-9) {
    return { ...from };
  }
  const scaledRadius = Math.tanh(Math.atanh(radius) * amount);
  const scaled = {
    x: (relative.x / radius) * scaledRadius,
    y: (relative.y / radius) * scaledRadius,
  };
  return diskInverseTransform(scaled, from);
}

function createGeodesicPolygonPath(vertices, offset) {
  const path = new Path2D();
  const first = toCanvasPoint(vertices[0], offset);
  path.moveTo(first.x, first.y);

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const geodesic = geodesicThrough(start, end);
    if (geodesic.type === "line" || geodesic.radiusSquared > 1e8) {
      const endPoint = toCanvasPoint(end, offset);
      path.lineTo(endPoint.x, endPoint.y);
      continue;
    }

    const radius = Math.sqrt(geodesic.radiusSquared);
    const startAngle = Math.atan2(start.y - geodesic.cy, start.x - geodesic.cx);
    const endAngle = Math.atan2(end.y - geodesic.cy, end.x - geodesic.cx);
    const delta = normalizeAngle(endAngle - startAngle);
    path.arc(
      DISK.x + geodesic.cx * DISK.radius + offset.x,
      DISK.y + geodesic.cy * DISK.radius + offset.y,
      radius * DISK.radius,
      startAngle,
      startAngle + delta,
      delta < 0,
    );
  }

  path.closePath();
  return path;
}

function toCanvasPoint(point, offset = { x: 0, y: 0 }) {
  return {
    x: DISK.x + point.x * DISK.radius + offset.x,
    y: DISK.y + point.y * DISK.radius + offset.y,
  };
}

function magnitude(point) {
  return Math.hypot(point.x, point.y);
}

function usesDarkTileColor(tileId) {
  let hash = Math.imul(tileId ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 100 < 28;
}

export default hyperbolicLevel;
