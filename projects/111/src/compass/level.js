import {
  canvasPointFromEvent,
  clamp,
  distance,
  line,
  pointInRect,
  resizeCanvasBuffer,
  roundedRect,
} from "../canvas-utils.js";

const SIZE = { width: 920, height: 620 };
const BOARD = { left: 18, top: 18, right: 902, bottom: 602 };
const POINT_HIT_RADIUS = 13;
const INTERSECTION_HIT_RADIUS = 12;
const DRAG_THRESHOLD = 6;
const GEOMETRY_EPSILON = 0.8;
const LABEL_EPSILON = 3;
const MIN_VIEW_SCALE = 0.55;
const MAX_VIEW_SCALE = 2.4;
const ZOOM_STEP = 1.2;

const PUZZLES = {
  transfer: buildTransferPuzzle(),
  midpoint: buildMidpointPuzzle(),
  inversion: buildInversionPuzzle(),
  circumcenter: buildCircumcenterPuzzle(),
  lineLine: buildLineLinePuzzle(),
  lineCircle: buildLineCirclePuzzle(),
};

const compassLevel = {
  id: "compass",
  blocks: [
    {
      type: "text",
      kicker: true,
      title: "单规作图",
      src: new URL("./content/intro.html", import.meta.url),
    },
    textBlock("./content/transfer.html"),
    canvasBlock("长度转移", PUZZLES.transfer),
    textBlock("./content/midpoint.html"),
    canvasBlock("作中点", PUZZLES.midpoint),
    textBlock("./content/inversion.html"),
    canvasBlock("点的反演", PUZZLES.inversion),
    textBlock("./content/circumcenter.html"),
    canvasBlock("三角形外心", PUZZLES.circumcenter),
    textBlock("./content/line-line.html"),
    canvasBlock("直线与直线交点", PUZZLES.lineLine),
    textBlock("./content/line-circle.html"),
    canvasBlock("圆与直线交点", PUZZLES.lineCircle),
  ],
};

function textBlock(src) {
  return {
    type: "text",
    src: new URL(src, import.meta.url),
  };
}

function canvasBlock(title, puzzle) {
  return {
    type: "canvas",
    title,
    caption: "单击两个可见点作圆；单击交点取点；隐藏模式下单击点可隐藏；单击圆周可隐藏圆；拖动平移，滚轮缩放。",
    width: SIZE.width,
    height: SIZE.height,
    ...puzzle,
    createController: (options) => new CompassController(options),
  };
}

function buildTransferPuzzle() {
  const A = point("A", 300, 320);
  const B = point("B", 440, 320);
  const C = point("C", 650, 235);
  const firstPair = orderedIntersections(
    geometryCircle(A, distance(A, B)),
    geometryCircle(B, distance(A, B)),
  );
  const D = point("D", firstPair[0].x, firstPair[0].y);
  const DPrime = point("D′", firstPair[1].x, firstPair[1].y);
  const EValue = reflectPoint(C, D, DPrime);
  const E = point("E", EValue.x, EValue.y);

  return {
    points: [A, B, C],
    expectedPoints: [D, DPrime, E],
    goalCircle: { centerLabel: "A", radius: distance(B, C) },
    guides: [],
  };
}

function buildMidpointPuzzle() {
  const A = point("A", 300, 360);
  const B = point("B", 460, 360);
  const radius = distance(A, B);
  const firstPair = orderedIntersections(
    geometryCircle(A, radius),
    geometryCircle(B, radius),
  );
  const C = point("C", firstPair[0].x, firstPair[0].y);
  const D = point("D", firstPair[1].x, firstPair[1].y);
  const extensionPair = orderedIntersections(
    geometryCircle(C, distance(C, D)),
    geometryCircle(D, distance(C, D)),
  );
  const E = point("E", extensionPair[0].x, extensionPair[0].y);
  const F = point("F", extensionPair[1].x, extensionPair[1].y);
  const inverseF = inverseConstruction(A, radius, F, {
    first: "U",
    second: "V",
    inverse: "M",
  });

  return {
    points: [A, B],
    expectedPoints: [C, D, E, F, ...inverseF.points],
    goalPoints: ["M"],
    guides: [{ type: "segment", from: "A", to: "B" }],
  };
}

function buildInversionPuzzle() {
  const O = point("O", 390, 330);
  const P = point("P", 520, 330);
  const radius = 180;
  const construction = inverseConstruction(O, radius, P, {
    first: "U",
    second: "V",
    inverse: "I",
  });

  return {
    points: [O, P],
    initialCircles: [{ centerLabel: "O", radius }],
    expectedPoints: construction.points,
    goalPoints: ["I"],
    guides: [],
  };
}

function buildCircumcenterPuzzle() {
  const A = point("A", 340, 340);
  const B = point("B", 500, 340);
  const C = point("C", 400, 200);
  const construction = circumcenterConstruction(A, B, C, {
    first: "U",
    second: "V",
    inverted: "D",
    reflected: "X",
    third: "G",
    fourth: "H",
    center: "O",
  });

  return {
    points: [A, B, C],
    expectedPoints: construction.points,
    goalPoints: ["O"],
    guides: [],
  };
}

function buildLineLinePuzzle() {
  const O = point("O", 350, 360);
  const A = point("A", 360, 210);
  const B = point("B", 760, 510);
  const C = point("C", 360, 560);
  const D = point("D", 760, 240);
  const radius = 180;

  const inverseA = inverseConstruction(O, radius, A, {
    first: "A₁", second: "A₂", inverse: "A′",
  });
  const inverseB = inverseConstruction(O, radius, B, {
    first: "B₁", second: "B₂", inverse: "B′",
  });
  const inverseC = inverseConstruction(O, radius, C, {
    first: "C₁", second: "C₂", inverse: "C′",
  });
  const inverseD = inverseConstruction(O, radius, D, {
    first: "D₁", second: "D₂", inverse: "D′",
  });

  const APrime = inverseA.inverse;
  const BPrime = inverseB.inverse;
  const CPrime = inverseC.inverse;
  const DPrime = inverseD.inverse;
  const centerE = circumcenterConstruction(APrime, O, BPrime, {
    first: "E₁", second: "E₂", inverted: "K₁", reflected: "L₁",
    third: "E₃", fourth: "E₄", center: "E",
  });
  const centerF = circumcenterConstruction(CPrime, O, DPrime, {
    first: "F₁", second: "F₂", inverted: "K₂", reflected: "L₂",
    third: "F₃", fourth: "F₄", center: "F",
  });

  const circleImages = orderedIntersections(
    geometryCircle(centerE.center, distance(centerE.center, O)),
    geometryCircle(centerF.center, distance(centerF.center, O)),
  );
  const yValue = circleImages.find((entry) => distance(entry, O) > LABEL_EPSILON);
  const Y = point("Y", yValue.x, yValue.y);
  const inverseY = inverseConstruction(O, radius, Y, {
    first: "Y₁", second: "Y₂", inverse: "X",
  });

  return {
    points: [O, A, B, C, D],
    initialCircles: [{ centerLabel: "O", radius }],
    expectedPoints: [
      ...inverseA.points,
      ...inverseB.points,
      ...inverseC.points,
      ...inverseD.points,
      ...centerE.points,
      ...centerF.points,
      Y,
      ...inverseY.points,
    ],
    goalPoints: ["X"],
    guides: [
      { type: "line", from: "A", to: "B" },
      { type: "line", from: "C", to: "D" },
    ],
  };
}

function buildLineCirclePuzzle() {
  const C = point("C", 360, 310);
  const A = point("A", 180, 440);
  const B = point("B", 760, 440);
  const radius = 190;
  const inverseA = inverseConstruction(C, radius, A, {
    first: "A₁", second: "A₂", inverse: "A′",
  });
  const inverseB = inverseConstruction(C, radius, B, {
    first: "B₁", second: "B₂", inverse: "B′",
  });
  const centerE = circumcenterConstruction(inverseA.inverse, C, inverseB.inverse, {
    first: "E₁", second: "E₂", inverted: "K", reflected: "L",
    third: "E₃", fourth: "E₄", center: "E",
  });
  const finalPair = orderedIntersections(
    geometryCircle(C, radius),
    geometryCircle(centerE.center, distance(centerE.center, C)),
  ).sort((first, second) => first.x - second.x);
  const P = point("P", finalPair[0].x, finalPair[0].y);
  const Q = point("Q", finalPair[1].x, finalPair[1].y);

  return {
    points: [C, A, B],
    initialCircles: [{ centerLabel: "C", radius }],
    expectedPoints: [
      ...inverseA.points,
      ...inverseB.points,
      ...centerE.points,
      P,
      Q,
    ],
    goalPoints: ["P", "Q"],
    guides: [
      { type: "line", from: "A", to: "B" },
    ],
  };
}

function inverseConstruction(center, radius, source, names) {
  const pair = orderedIntersections(
    geometryCircle(center, radius),
    geometryCircle(source, distance(source, center)),
  );
  if (pair.length !== 2) {
    throw new Error(`The inversion construction for ${source.label} is degenerate.`);
  }
  const first = point(names.first, pair[0].x, pair[0].y);
  const second = point(names.second, pair[1].x, pair[1].y);
  const inverseValue = invertPoint(source, center, radius);
  const inverse = point(names.inverse, inverseValue.x, inverseValue.y);
  return { points: [first, second, inverse], first, second, inverse };
}

function circumcenterConstruction(first, second, third, names) {
  const radius = distance(first, second);
  const inverseThird = inverseConstruction(first, radius, third, {
    first: names.first,
    second: names.second,
    inverse: names.inverted,
  });
  const reflectedValue = reflectPoint(first, second, inverseThird.inverse);
  const reflected = point(names.reflected, reflectedValue.x, reflectedValue.y);
  const inverseReflected = inverseConstruction(first, radius, reflected, {
    first: names.third,
    second: names.fourth,
    inverse: names.center,
  });
  return {
    points: [
      inverseThird.first,
      inverseThird.second,
      inverseThird.inverse,
      reflected,
      inverseReflected.first,
      inverseReflected.second,
      inverseReflected.inverse,
    ],
    center: inverseReflected.inverse,
  };
}

class CompassController {
  constructor({ config, canvas, onSolved }) {
    this.config = config;
    this.canvas = canvas;
    this.onSolved = onSolved;
    this.ctx = canvas.getContext("2d");
    this.points = config.points.map((entry) => ({
      ...entry,
      initial: true,
      hidden: false,
    }));
    this.circles = this.createInitialCircles();
    this.history = [];
    this.selectedPoint = -1;
    this.viewOffset = { x: 0, y: 0 };
    this.viewScale = 1;
    this.hidePointMode = false;
    this.pointer = null;
    this.solved = false;
    this.buttons = [
      { id: "zoomOut", label: "−", x: 590, y: 30, width: 38, height: 38 },
      { id: "zoomIn", label: "+", x: 636, y: 30, width: 38, height: 38 },
      { id: "hidePoint", label: "隐藏点", x: 682, y: 30, width: 82, height: 38 },
      { id: "undo", label: "撤销", x: 772, y: 30, width: 54, height: 38 },
      { id: "reset", label: "重置", x: 834, y: 30, width: 56, height: 38 },
    ];

    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerUp = this.handlePointerUp.bind(this);
    this.onPointerCancel = this.handlePointerCancel.bind(this);
    this.onWheel = this.handleWheel.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
    this.onResize = () => {
      resizeCanvasBuffer(
        this.canvas,
        this.ctx,
        this.config.width,
        this.config.height,
      );
      this.draw();
    };
    resizeCanvasBuffer(
      this.canvas,
      this.ctx,
      this.config.width,
      this.config.height,
    );
    this.canvas.style.cursor = "grab";
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", this.onResize);
    this.updateAccessibility();
    this.draw();
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("resize", this.onResize);
  }

  createInitialCircles() {
    return (this.config.initialCircles || []).map((entry) => ({
      center: this.points.findIndex((pointValue) => pointValue.label === entry.centerLabel),
      radius: entry.radius,
      initial: true,
      hidden: false,
    }));
  }

  handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undo();
    }
    if (event.key === "Escape") {
      this.selectedPoint = -1;
      this.hidePointMode = false;
      this.draw();
    }
  }

  handleWheel(event) {
    event.preventDefault();
    const at = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    if (!pointInRect(at, BOARD)) return;
    this.zoomAt(at, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  handlePointerDown(event) {
    event.preventDefault();
    const at = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const button = this.buttons.find((entry) => pointInRect(at, entry));
    if (button) {
      if (button.id === "zoomOut") this.zoomAt(boardCenter(), 1 / ZOOM_STEP);
      if (button.id === "zoomIn") this.zoomAt(boardCenter(), ZOOM_STEP);
      if (button.id === "hidePoint" && !this.solved) {
        this.hidePointMode = !this.hidePointMode;
        this.selectedPoint = -1;
        this.updateAccessibility();
        this.draw();
      }
      if (this.solved) return;
      if (button.id === "undo") this.undo();
      if (button.id === "reset") this.reset();
      return;
    }
    if (this.solved || !pointInRect(at, BOARD)) return;

    this.pointer = {
      id: event.pointerId,
      start: at,
      originOffset: { ...this.viewOffset },
      dragged: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.canvas.style.cursor = "grabbing";
  }

  handlePointerMove(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    event.preventDefault();
    const at = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const dx = at.x - this.pointer.start.x;
    const dy = at.y - this.pointer.start.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) this.pointer.dragged = true;
    if (!this.pointer.dragged) return;

    this.viewOffset = {
      x: clamp(this.pointer.originOffset.x + dx, -460, 460),
      y: clamp(this.pointer.originOffset.y + dy, -360, 360),
    };
    this.draw();
  }

  handlePointerUp(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    event.preventDefault();
    const at = canvasPointFromEvent(
      this.canvas,
      event,
      this.config.width,
      this.config.height,
    );
    const dragged = this.pointer.dragged;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.pointer = null;
    this.canvas.style.cursor = "grab";
    if (!dragged) this.activateAt(at);
  }

  handlePointerCancel(event) {
    if (!this.pointer || event.pointerId !== this.pointer.id) return;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.pointer = null;
    this.canvas.style.cursor = "grab";
  }

  activateAt(screenPoint) {
    const at = this.screenToWorld(screenPoint);

    const pointIndex = this.findPoint(at);
    if (pointIndex >= 0) {
      if (this.hidePointMode) {
        const pointValue = this.points[pointIndex];
        this.history.push({
          type: "pointVisibility",
          point: pointValue,
          hidden: pointValue.hidden,
        });
        pointValue.hidden = true;
        this.selectedPoint = -1;
        this.updateAccessibility();
        this.draw();
        return;
      }
      this.selectPoint(pointIndex);
      return;
    }

    if (this.hidePointMode) return;

    const candidate = this.intersections().find(
      (entry) => distance(entry, at) <= INTERSECTION_HIT_RADIUS / this.viewScale,
    );
    if (candidate) {
      const expected = this.config.expectedPoints.find(
        (entry) =>
          !this.points.some((known) => known.label === entry.label) &&
          distance(entry, candidate) <= LABEL_EPSILON,
      );
      const label = expected?.label || nextGenericLabel(this.points);
      this.points.push({
        ...candidate,
        label,
        initial: false,
        expected: Boolean(expected),
        hidden: false,
      });
      this.history.push({ type: "point" });
      this.selectedPoint = -1;
      this.updateAccessibility();
      this.checkSolved();
      this.draw();
      return;
    }

    const circleIndex = this.findCircleAt(at);
    if (circleIndex >= 0) {
      const circleValue = this.circles[circleIndex];
      this.history.push({ type: "visibility", circle: circleValue, hidden: circleValue.hidden });
      circleValue.hidden = true;
      this.selectedPoint = -1;
      this.updateAccessibility();
      this.draw();
    }
  }

  selectPoint(index) {
    if (this.selectedPoint < 0) {
      this.selectedPoint = index;
      this.draw();
      return;
    }
    if (this.selectedPoint === index) {
      this.selectedPoint = -1;
      this.draw();
      return;
    }

    const centerIndex = this.selectedPoint;
    const radius = distance(this.points[centerIndex], this.points[index]);
    const exists = this.circles.some(
      (circleValue) =>
        !circleValue.hidden &&
        circleValue.center === centerIndex &&
        Math.abs(circleValue.radius - radius) < GEOMETRY_EPSILON,
    );
    if (!exists) {
      this.circles.push({
        center: centerIndex,
        radius,
        initial: false,
        hidden: false,
      });
      this.history.push({ type: "circle" });
    }
    this.selectedPoint = -1;
    this.updateAccessibility();
    this.checkSolved();
    this.draw();
  }

  undo() {
    const action = this.history.pop();
    if (!action) return;
    if (action.type === "circle") this.circles.pop();
    if (action.type === "point") this.points.pop();
    if (action.type === "visibility") action.circle.hidden = action.hidden;
    if (action.type === "pointVisibility") action.point.hidden = action.hidden;
    this.selectedPoint = -1;
    this.updateAccessibility();
    this.draw();
  }

  reset() {
    this.points = this.config.points.map((entry) => ({
      ...entry,
      initial: true,
      hidden: false,
    }));
    this.circles = this.createInitialCircles();
    this.history.length = 0;
    this.selectedPoint = -1;
    this.viewOffset = { x: 0, y: 0 };
    this.viewScale = 1;
    this.hidePointMode = false;
    this.updateAccessibility();
    this.draw();
  }

  checkSolved() {
    if (this.solved) return;
    const pointGoalSolved = !this.config.goalPoints || this.config.goalPoints.every(
      (label) => this.points.some((entry) => entry.label === label),
    );
    const circleGoalSolved = !this.config.goalCircle || this.circles.some((entry) => {
      const center = this.points[entry.center];
      return this.isCircleActive(entry) &&
        center.label === this.config.goalCircle.centerLabel &&
        Math.abs(entry.radius - this.config.goalCircle.radius) <= LABEL_EPSILON;
    });
    if (!pointGoalSolved || !circleGoalSolved) return;

    this.solved = true;
    this.updateAccessibility();
    this.draw();
    this.onSolved();
  }

  updateAccessibility() {
    const acquired = this.points.filter((entry) => entry.expected).length;
    const visiblePoints = this.points.filter((entry) => !entry.hidden).length;
    const visibleCircles = this.circles.filter((entry) => this.isCircleActive(entry)).length;
    this.canvas.setAttribute(
      "aria-label",
      `${this.config.title}，${visiblePoints} 个点、${visibleCircles} 个圆可用，缩放 ${Math.round(this.viewScale * 100)}%，取得 ${acquired} 个关键交点${this.hidePointMode ? "，隐藏点模式" : ""}`,
    );
  }

  isCircleActive(circleValue) {
    return !circleValue.hidden && !this.points[circleValue.center]?.hidden;
  }

  intersections() {
    const candidates = [];
    for (let first = 0; first < this.circles.length; first += 1) {
      for (let second = first + 1; second < this.circles.length; second += 1) {
        const firstCircle = this.circles[first];
        const secondCircle = this.circles[second];
        if (!this.isCircleActive(firstCircle) || !this.isCircleActive(secondCircle)) continue;
        const geometryFirst = geometryCircle(
          this.points[firstCircle.center],
          firstCircle.radius,
        );
        const geometrySecond = geometryCircle(
          this.points[secondCircle.center],
          secondCircle.radius,
        );
        for (const at of circleIntersections(geometryFirst, geometrySecond)) {
          const screenPoint = this.worldToScreen(at);
          if (!pointInRect(screenPoint, BOARD)) continue;
          if (this.points.some((entry) => distance(entry, at) < 5)) continue;
          if (!candidates.some((entry) => distance(entry, at) < 5)) candidates.push(at);
        }
      }
    }
    return candidates;
  }

  findPoint(at) {
    for (let index = this.points.length - 1; index >= 0; index -= 1) {
      if (this.points[index].hidden) continue;
      if (distance(this.points[index], at) <= POINT_HIT_RADIUS / this.viewScale) return index;
    }
    return -1;
  }

  findCircleAt(at) {
    for (let index = this.circles.length - 1; index >= 0; index -= 1) {
      const entry = this.circles[index];
      if (!this.isCircleActive(entry)) continue;
      const center = this.points[entry.center];
      if (Math.abs(distance(center, at) - entry.radius) <= 7 / this.viewScale) return index;
    }
    return -1;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.config.width, this.config.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, this.config.width, this.config.height);
    this.drawPaper();
    ctx.save();
    ctx.beginPath();
    ctx.rect(BOARD.left, BOARD.top, BOARD.right - BOARD.left, BOARD.bottom - BOARD.top);
    ctx.clip();
    const center = boardCenter();
    ctx.translate(center.x + this.viewOffset.x, center.y + this.viewOffset.y);
    ctx.scale(this.viewScale, this.viewScale);
    ctx.translate(-center.x, -center.y);
    this.drawGuides();
    this.drawCircles();
    this.drawIntersections();
    this.drawPoints();
    ctx.restore();
    this.drawFloatingControls();
  }

  drawFloatingControls() {
    const ctx = this.ctx;
    ctx.save();
    ctx.textBaseline = "middle";
    for (const button of this.buttons) {
      const active = button.id === "hidePoint" && this.hidePointMode;
      const disabled = this.solved && !button.id.startsWith("zoom");
      ctx.save();
      ctx.shadowColor = "rgba(15, 23, 42, 0.14)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = active ? "#e8eefc" : disabled ? "#f1f3f5" : "#ffffff";
      ctx.strokeStyle = active ? "#2457c5" : "#b9c3d0";
      ctx.lineWidth = 1.5;
      roundedRect(ctx, button.x, button.y, button.width, button.height, 6);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.stroke();
      ctx.fillStyle = disabled ? "#9aa1aa" : active ? "#2457c5" : "#28303b";
      ctx.font = button.id.startsWith("zoom")
        ? "500 22px system-ui, sans-serif"
        : "500 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2 + 1);
      ctx.restore();
    }
    ctx.restore();
  }

  drawPaper() {
    const ctx = this.ctx;
    ctx.fillStyle = "#fffefb";
    ctx.fillRect(BOARD.left, BOARD.top, BOARD.right - BOARD.left, BOARD.bottom - BOARD.top);
    ctx.save();
    ctx.beginPath();
    ctx.rect(BOARD.left, BOARD.top, BOARD.right - BOARD.left, BOARD.bottom - BOARD.top);
    ctx.clip();
    ctx.strokeStyle = "#edf0f3";
    ctx.lineWidth = 1;
    const topLeft = this.screenToWorld({ x: BOARD.left, y: BOARD.top });
    const bottomRight = this.screenToWorld({ x: BOARD.right, y: BOARD.bottom });
    const firstGridX = Math.floor(topLeft.x / 24) * 24;
    const firstGridY = Math.floor(topLeft.y / 24) * 24;
    for (let worldX = firstGridX; worldX <= bottomRight.x; worldX += 24) {
      const screenX = this.worldToScreen({ x: worldX, y: 0 }).x;
      line(ctx, screenX, BOARD.top, screenX, BOARD.bottom);
    }
    for (let worldY = firstGridY; worldY <= bottomRight.y; worldY += 24) {
      const screenY = this.worldToScreen({ x: 0, y: worldY }).y;
      line(ctx, BOARD.left, screenY, BOARD.right, screenY);
    }
    ctx.restore();
    ctx.strokeStyle = "#cfd6df";
    ctx.lineWidth = 1;
    ctx.strokeRect(BOARD.left, BOARD.top, BOARD.right - BOARD.left, BOARD.bottom - BOARD.top);
  }

  drawGuides() {
    const ctx = this.ctx;
    for (const guide of this.config.guides) {
      const from = this.points.find((entry) => entry.label === guide.from);
      const to = this.points.find((entry) => entry.label === guide.to);
      if (!from || !to) continue;
      ctx.strokeStyle = "rgba(91, 103, 119, 0.48)";
      ctx.lineWidth = 1.5 / this.viewScale;
      ctx.setLineDash([8 / this.viewScale, 7 / this.viewScale]);
      if (guide.type === "segment") {
        line(ctx, from.x, from.y, to.x, to.y);
      } else {
        drawInfiniteLine(ctx, from, to);
      }
      ctx.setLineDash([]);
    }
  }

  drawCircles() {
    const ctx = this.ctx;
    this.circles.forEach((entry) => {
      if (!this.isCircleActive(entry)) return;
      const center = this.points[entry.center];
      ctx.strokeStyle = entry.initial ? "#a8afb8" : "#2457c5";
      ctx.lineWidth = (entry.initial ? 2.5 : 1.6) / this.viewScale;
      ctx.setLineDash([]);
      circle(ctx, center.x, center.y, entry.radius);
    });
  }

  drawIntersections() {
    const ctx = this.ctx;
    for (const entry of this.intersections()) {
      ctx.fillStyle = "#7b8490";
      ctx.beginPath();
      ctx.arc(entry.x, entry.y, 4 / this.viewScale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPoints() {
    const ctx = this.ctx;
    this.points.forEach((entry, index) => {
      if (entry.hidden) return;
      const selected = index === this.selectedPoint;
      ctx.fillStyle = entry.initial ? "#1f2937" : entry.expected ? "#16794c" : "#2457c5";
      ctx.strokeStyle = selected ? "#f59e0b" : "#ffffff";
      ctx.lineWidth = (selected ? 4 : 2) / this.viewScale;
      circle(ctx, entry.x, entry.y, (selected ? 8 : 6) / this.viewScale, true);
      if (entry.initial) {
        ctx.fillStyle = "#202631";
        ctx.font = `600 ${14 / this.viewScale}px system-ui, sans-serif`;
        ctx.fillText(
          entry.label,
          entry.x + 11 / this.viewScale,
          entry.y - 11 / this.viewScale,
        );
      }
    });
  }

  screenToWorld(screenPoint) {
    const center = boardCenter();
    return {
      x: center.x + (screenPoint.x - center.x - this.viewOffset.x) / this.viewScale,
      y: center.y + (screenPoint.y - center.y - this.viewOffset.y) / this.viewScale,
    };
  }

  worldToScreen(worldPoint) {
    const center = boardCenter();
    return {
      x: center.x + this.viewOffset.x + (worldPoint.x - center.x) * this.viewScale,
      y: center.y + this.viewOffset.y + (worldPoint.y - center.y) * this.viewScale,
    };
  }

  zoomAt(screenPoint, factor) {
    const previousScale = this.viewScale;
    const nextScale = clamp(previousScale * factor, MIN_VIEW_SCALE, MAX_VIEW_SCALE);
    if (Math.abs(nextScale - previousScale) < 0.0001) return;
    const worldPoint = this.screenToWorld(screenPoint);
    const center = boardCenter();
    this.viewScale = nextScale;
    this.viewOffset = {
      x: screenPoint.x - center.x - (worldPoint.x - center.x) * nextScale,
      y: screenPoint.y - center.y - (worldPoint.y - center.y) * nextScale,
    };
    this.updateAccessibility();
    this.draw();
  }
}

function point(label, x, y) {
  return { label, x, y };
}

function geometryCircle(center, radius) {
  return { center, radius };
}

function circleIntersections(first, second) {
  const a = first.center;
  const b = second.center;
  const d = distance(a, b);
  if (
    d < 0.0001 ||
    d > first.radius + second.radius + GEOMETRY_EPSILON ||
    d < Math.abs(first.radius - second.radius) - GEOMETRY_EPSILON
  ) {
    return [];
  }
  const along = (first.radius ** 2 - second.radius ** 2 + d ** 2) / (2 * d);
  const heightSquared = Math.max(0, first.radius ** 2 - along ** 2);
  const height = Math.sqrt(heightSquared);
  const baseX = a.x + (along * (b.x - a.x)) / d;
  const baseY = a.y + (along * (b.y - a.y)) / d;
  const offsetX = (-height * (b.y - a.y)) / d;
  const offsetY = (height * (b.x - a.x)) / d;
  const one = { x: baseX + offsetX, y: baseY + offsetY };
  if (height < GEOMETRY_EPSILON) return [one];
  return [one, { x: baseX - offsetX, y: baseY - offsetY }];
}

function orderedIntersections(first, second) {
  return circleIntersections(first, second).sort(
    (a, b) => a.y - b.y || a.x - b.x,
  );
}

function invertPoint(source, center, radius) {
  const dx = source.x - center.x;
  const dy = source.y - center.y;
  const scale = radius ** 2 / (dx * dx + dy * dy);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function reflectPoint(source, first, second) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const scale =
    ((source.x - first.x) * dx + (source.y - first.y) * dy) /
    (dx * dx + dy * dy);
  const projection = { x: first.x + scale * dx, y: first.y + scale * dy };
  return { x: projection.x * 2 - source.x, y: projection.y * 2 - source.y };
}

function drawInfiniteLine(ctx, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  line(ctx, from.x - dx * 10, from.y - dy * 10, from.x + dx * 10, from.y + dy * 10);
}

function nextGenericLabel(points) {
  let index = 1;
  while (points.some((entry) => entry.label === `Z${index}`)) index += 1;
  return `Z${index}`;
}

function boardCenter() {
  return {
    x: (BOARD.left + BOARD.right) / 2,
    y: (BOARD.top + BOARD.bottom) / 2,
  };
}

function circle(ctx, x, y, radius, fill = false) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (fill) ctx.fill();
  ctx.stroke();
}

export default compassLevel;
