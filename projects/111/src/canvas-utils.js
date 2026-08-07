export function resizeCanvasBuffer(canvas, context, width, height) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

export function canvasPointFromEvent(canvas, event, width, height) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  };
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

export function line(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

export function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export function pointInRect(point, rect) {
  const left = rect.left ?? rect.x;
  const top = rect.top ?? rect.y;
  const right = rect.right ?? left + rect.width;
  const bottom = rect.bottom ?? top + rect.height;
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}
