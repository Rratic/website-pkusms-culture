import levels from "./levels.js";

  const STORAGE_KEY = "project-111:level-times";
  const LEVELS = levels.filter(Boolean);
  const levelsById = new Map(LEVELS.map((level) => [level.id, level]));
  const levelContent = document.querySelector("#level-content");

  let activeLevel = null;
  let startedAt = 0;
  let isComplete = false;
  let canvasState = new Map();
  let activeCanvasControllers = [];
  let renderedBlocks = [];
  let renderRequestId = 0;

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

  function getLevelFromHash() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    return levelsById.get(id) || LEVELS[0];
  }

  function getCanvasBlocks(level) {
    return (level.blocks || []).filter((block) => block.type === "canvas");
  }

  async function loadTextBlock(block) {
    if (!block.src) {
      throw new Error(`Text block "${block.id}" must provide src.`);
    }

    const response = await fetch(block.src);
    if (!response.ok) {
      throw new Error(`Unable to load ${response.url}: HTTP ${response.status}.`);
    }

    return { ...block, html: await response.text() };
  }

  async function loadLevelBlocks(level) {
    return Promise.all(
      (level.blocks || []).map((block) =>
        block.type === "text" ? loadTextBlock(block) : block,
      ),
    );
  }

  function getRequiredCanvasIds(block, blockIndex) {
    if (Array.isArray(block.requires)) {
      return block.requires;
    }

    return activeLevel.blocks
      .slice(0, blockIndex)
      .filter((precedingBlock) => precedingBlock.type === "canvas")
      .map((precedingBlock) => precedingBlock.id);
  }

  function isBlockUnlocked(block, blockIndex) {
    return getRequiredCanvasIds(block, blockIndex).every(
      (canvasId) => canvasState.get(canvasId) === true,
    );
  }

  function scrollToBlock(element) {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";

    window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior, block: "start" });
    });
  }

  function updateBlockVisibility() {
    const newlyVisible = [];

    renderedBlocks.forEach(({ block, element }, index) => {
      const unlocked = isBlockUnlocked(block, index);
      if (element.hidden && unlocked) {
        newlyVisible.push(element);
      }
      element.hidden = !unlocked;
    });

    return newlyVisible;
  }

  function renderRichTextBlock(block) {
    const panel = document.createElement("article");
    panel.className = "story-panel";

    if (block.kicker) {
      const kicker = document.createElement("div");
      kicker.className = "level-kicker";
      kicker.textContent = block.kicker;
      panel.append(kicker);
    }

    if (block.title) {
      const title = document.createElement("h1");
      title.textContent = block.title;
      panel.append(title);
    }

    const content = document.createElement("div");
    content.className = "rich-text";
    content.innerHTML = block.html || "";
    panel.append(content);
    return { block, element: panel };
  }

  function renderCanvasBlock(config, blockIndex) {
    const panel = document.createElement("section");
    panel.className = "canvas-panel";

    const contentId = `canvas-panel-content-${blockIndex}`;
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
    titleRow.addEventListener("click", () => {
      const isExpanded = titleRow.getAttribute("aria-expanded") === "true";
      titleRow.setAttribute("aria-expanded", String(!isExpanded));
      content.hidden = isExpanded;

      if (isExpanded === false && canvasState.get(config.id) !== true) {
        scrollToBlock(panel);
      }
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

    return { block: config, element: panel, stateBadge: state };
  }

  function renderActionsBlock(block) {
    const panel = document.createElement("footer");
    panel.className = "level-actions";

    const actions = document.createElement("div");
    actions.className = "exit-actions";
    actions.append(
      ...(block.actions || []).map((action) => {
        const link = document.createElement("a");
        link.className = "exit-button";
        link.href = `#${encodeURIComponent(action.target)}`;
        link.textContent = action.label;
        return link;
      }),
    );

    panel.append(actions);
    return { block, element: panel };
  }

  function renderBlock(block, blockIndex) {
    if (block.type === "text") {
      return renderRichTextBlock(block);
    }

    if (block.type === "canvas") {
      return renderCanvasBlock(block, blockIndex);
    }

    if (block.type === "actions") {
      return renderActionsBlock(block);
    }

    throw new Error(`Unknown level block type: "${block.type}".`);
  }

  function completeLevel() {
    if (isComplete) {
      return false;
    }

    isComplete = true;
    const elapsedMs = performance.now() - startedAt;
    const records = readRecords();
    const current = records[activeLevel.id] || {};

    records[activeLevel.id] = {
      attempts: (current.attempts || 0) + 1,
      bestMs: current.bestMs == null ? elapsedMs : Math.min(current.bestMs, elapsedMs),
      lastMs: elapsedMs,
      completedAt: new Date().toISOString(),
    };

    writeRecords(records);
    return true;
  }

  function markCanvasSolved(canvasId) {
    if (!canvasState.has(canvasId)) {
      return;
    }

    canvasState.set(canvasId, true);
    const newlyVisible = updateBlockVisibility();

    if (Array.from(canvasState.values()).every(Boolean)) {
      completeLevel();
    }

    if (newlyVisible.length > 0) {
      scrollToBlock(newlyVisible[0]);
    }
  }

  window.completeCurrentLevel = () => {
    if (!activeLevel || isComplete) {
      return false;
    }

    canvasState.forEach((value, canvasId) => canvasState.set(canvasId, true));
    renderedBlocks.forEach(({ block, stateBadge }) => {
      if (block.type === "canvas" && stateBadge) {
        stateBadge.textContent = "已完成";
        stateBadge.classList.add("is-solved");
      }
    });
    const newlyVisible = updateBlockVisibility();
    const completed = completeLevel();

    if (newlyVisible.length > 0) {
      scrollToBlock(newlyVisible[0]);
    }

    return completed;
  };

  function showLoadError(level, error) {
    activeCanvasControllers.forEach((controller) => controller.destroy());
    activeCanvasControllers = [];
    renderedBlocks = [];
    activeLevel = null;

    const panel = document.createElement("article");
    panel.className = "story-panel";
    const title = document.createElement("h1");
    title.textContent = level.id;
    const content = document.createElement("div");
    content.className = "rich-text";
    const message = document.createElement("p");
    message.textContent = "关卡内容加载失败。";
    content.append(message);
    panel.append(title, content);
    levelContent.replaceChildren(panel);
    console.error(error);
  }

  async function renderLevel(level) {
    const requestId = ++renderRequestId;
    let blocks;

    try {
      blocks = await loadLevelBlocks(level);
    } catch (error) {
      if (requestId === renderRequestId) {
        showLoadError(level, error);
      }
      return;
    }

    if (requestId !== renderRequestId) {
      return;
    }

    activeCanvasControllers.forEach((controller) => controller.destroy());
    activeCanvasControllers = [];
    renderedBlocks = [];
    activeLevel = { ...level, blocks };
    startedAt = performance.now();
    isComplete = false;
    canvasState = new Map(getCanvasBlocks(activeLevel).map((canvas) => [canvas.id, false]));

    renderedBlocks = activeLevel.blocks.map(renderBlock);
    levelContent.replaceChildren(...renderedBlocks.map(({ element }) => element));
    updateBlockVisibility();
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

    void renderLevel(level);
  }

  window.addEventListener("hashchange", handleRouteChange);
  handleRouteChange();
