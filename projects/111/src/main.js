(function () {
  const STORAGE_KEY = "project-111:level-times";
  const LEVELS = (window.PUZZLE_LEVELS || []).filter(Boolean);
  const levelsById = new Map(LEVELS.map((level) => [level.id, level]));

  const elements = {
    levelName: document.querySelector("#current-level-name"),
    elapsedTime: document.querySelector("#elapsed-time"),
    bestTime: document.querySelector("#best-time"),
    levelNav: document.querySelector("#level-nav"),
    kicker: document.querySelector("#level-kicker"),
    title: document.querySelector("#level-title"),
    copy: document.querySelector("#level-copy"),
    canvasGrid: document.querySelector("#canvas-grid"),
    levelActions: document.querySelector(".level-actions"),
    completionState: document.querySelector("#completion-state"),
    exitActions: document.querySelector("#exit-actions"),
  };

  let activeLevel = null;
  let startedAt = 0;
  let completedElapsedMs = 0;
  let timerId = 0;
  let isComplete = false;
  let canvasState = new Map();
  let activeCanvasControllers = [];

  function readRecords() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (error) {
      return {};
    }
  }

  function writeRecords(records) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function formatTime(ms) {
    if (!Number.isFinite(ms)) {
      return "--:--";
    }

    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const two = (value) => String(value).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${two(minutes)}:${two(seconds)}`;
    }

    return `${two(minutes)}:${two(seconds)}`;
  }

  function getLevelFromHash() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    return levelsById.get(id) || LEVELS[0];
  }

  function setText(node, value) {
    if (!node) {
      return;
    }

    node.textContent = value == null ? "" : String(value);
  }

  function renderNavigation() {
    if (!elements.levelNav) {
      return;
    }

    const records = readRecords();
    elements.levelNav.replaceChildren(
      ...LEVELS.map((level) => {
        const link = document.createElement("a");
        const isActive = activeLevel && activeLevel.id === level.id;

        link.className = `level-link${isActive ? " is-active" : ""}`;
        link.href = `#${encodeURIComponent(level.id)}`;
        link.setAttribute("aria-current", isActive ? "page" : "false");

        const index = document.createElement("span");
        index.className = "level-index";
        index.textContent = level.order;

        const title = document.createElement("span");
        title.className = "level-link-title";
        title.textContent = level.title;

        const time = document.createElement("span");
        time.className = "level-link-time";
        time.textContent = formatTime(records[level.id]?.bestMs);

        link.append(index, title, time);
        return link;
      }),
    );
  }

  function renderExits() {
    const exits = activeLevel.exits || [];

    elements.exitActions.replaceChildren(
      ...exits.map((exit) => {
        const link = document.createElement("a");
        link.className = `exit-button${isComplete ? "" : " is-disabled"}`;
        link.href = isComplete ? `#${encodeURIComponent(exit.target)}` : "#";
        link.textContent = exit.label;
        link.setAttribute("aria-disabled", String(!isComplete));
        return link;
      }),
    );
  }

  function updateCompletionText() {
    elements.levelActions.hidden = !isComplete;
    elements.completionState.classList.toggle("is-complete", isComplete);
    elements.completionState.textContent = isComplete
      ? activeLevel.completionText || "已完成"
      : "";
  }

  function completeLevel() {
    if (isComplete) {
      return;
    }

    isComplete = true;
    const elapsedMs = performance.now() - startedAt;
    completedElapsedMs = elapsedMs;
    const records = readRecords();
    const current = records[activeLevel.id] || {};

    records[activeLevel.id] = {
      attempts: (current.attempts || 0) + 1,
      bestMs: current.bestMs == null ? elapsedMs : Math.min(current.bestMs, elapsedMs),
      lastMs: elapsedMs,
      completedAt: new Date().toISOString(),
    };

    writeRecords(records);
    window.clearInterval(timerId);
    setText(elements.elapsedTime, formatTime(elapsedMs));
    setText(elements.bestTime, formatTime(records[activeLevel.id].bestMs));
    renderNavigation();
    renderExits();
    updateCompletionText();
  }

  window.completeCurrentLevel = () => {
    if (!activeLevel || isComplete) {
      return false;
    }

    canvasState.forEach((value, canvasId) => canvasState.set(canvasId, true));
    completeLevel();
    return true;
  };

  function updateTimer() {
    if (!activeLevel) {
      return;
    }

    if (isComplete) {
      return;
    }

    const elapsedMs = performance.now() - startedAt;
    setText(elements.elapsedTime, formatTime(elapsedMs));
    updateCompletionText();
  }

  function markCanvasSolved(canvasId) {
    canvasState.set(canvasId, true);

    if (Array.from(canvasState.values()).every(Boolean)) {
      completeLevel();
    } else {
      updateCompletionText();
    }
  }

  function renderLevel(level) {
    activeLevel = level;
    startedAt = performance.now();
    completedElapsedMs = 0;
    isComplete = false;
    canvasState = new Map(level.canvases.map((canvas) => [canvas.id, false]));

    window.clearInterval(timerId);
    timerId = window.setInterval(updateTimer, 500);

    readRecords();
    setText(elements.levelName, level.title);
    setText(elements.bestTime, "");
    setText(elements.kicker, level.kicker);
    setText(elements.title, level.title);
    elements.copy.innerHTML = level.copy;

    renderNavigation();
    renderCanvases(level.canvases);
    renderExits();
    updateTimer();
  }

  function renderCanvases(canvases) {
    activeCanvasControllers.forEach((controller) => controller.destroy());
    activeCanvasControllers = [];

    elements.canvasGrid.replaceChildren(
      ...canvases.map((config, index) => {
        const panel = document.createElement("section");
        panel.className = "canvas-panel";

        const contentId = `canvas-panel-content-${index}`;
        const titleRow = document.createElement("button");
        titleRow.className = "canvas-title-row";
        titleRow.type = "button";
        titleRow.setAttribute("aria-expanded", "false");
        titleRow.setAttribute("aria-controls", contentId);

        const title = document.createElement("span");
        title.className = "canvas-title";
        title.textContent = config.title;

        const state = document.createElement("span");
        state.className = "canvas-state";
        state.textContent = "进行中";
        state.setAttribute("aria-live", "polite");

        const controls = document.createElement("span");
        controls.className = "canvas-controls";
        controls.append(state);

        titleRow.append(title, controls);

        const content = document.createElement("div");
        content.className = "canvas-panel-content";
        content.id = contentId;
        content.hidden = true;
        let isExpanded = false;
        titleRow.addEventListener("click", () => {
          isExpanded = !isExpanded;
          titleRow.setAttribute("aria-expanded", String(isExpanded));
          content.hidden = !isExpanded;
        });

        const frame = document.createElement("div");
        frame.className = "canvas-frame";
        frame.style.setProperty("--canvas-width", config.width);
        frame.style.setProperty("--canvas-height", config.height);

        const canvas = document.createElement("canvas");
        canvas.className = "puzzle-canvas";
        canvas.width = config.width;
        canvas.height = config.height;
        canvas.tabIndex = 0;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", config.title);

        const caption = document.createElement("div");
        caption.className = "canvas-caption";
        caption.textContent = config.caption || "";

        frame.append(canvas);
        content.append(frame, caption);
        panel.append(titleRow, content);
        if (typeof config.createController !== "function") {
          throw new Error(`Canvas "${config.id}" must provide createController().`);
        }

        activeCanvasControllers.push(
          config.createController({
            config,
            canvas,
            caption,
            stateBadge: state,
            onSolved: markCanvasSolved,
          }),
        );
        return panel;
      }),
    );
  }

  function handleRouteChange() {
    const requestedId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const level = getLevelFromHash();

    if (!level) {
      return;
    }

    if (requestedId !== level.id) {
      history.replaceState(null, "", `#${encodeURIComponent(level.id)}`);
    }

    renderLevel(level);
  }

  window.addEventListener("hashchange", handleRouteChange);
  handleRouteChange();
})();
