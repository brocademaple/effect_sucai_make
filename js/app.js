/**
 * 特效素材制作器 - 图片背景去除工具
 * 核心应用逻辑
 */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    image: null,          // Original HTMLImageElement
    imageData: null,      // Original ImageData (never modified)
    currentData: null,    // Current ImageData (with modifications)
    maskData: null,       // Alpha mask: 255 = visible, 0 = removed
    tool: 'select',
    brushShape: 'circle', // 'circle' | 'square' | 'line'
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    selection: null,      // { x, y, w, h } in image coords
    history: [],
    historyIndex: -1,
    maxHistory: 30,
    previewBg: 'checkerboard',
  };

  // ===== DOM References =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    fileInput: $('#fileInput'),
    uploadHint: $('#uploadHint'),
    canvasContainer: $('#canvasContainer'),
    canvasWrapper: $('#canvasWrapper'),
    mainCanvas: $('#mainCanvas'),
    overlayCanvas: $('#overlayCanvas'),
    previewCanvas: $('#previewCanvas'),
    btnUpload: $('#btnUpload'),
    btnUploadCenter: $('#btnUploadCenter'),
    selectionActions: $('#selectionActions'),
    btnDeleteSelection: $('#btnDeleteSelection'),
    btnCancelSelection: $('#btnCancelSelection'),
    btnExportHeader: $('#btnExportHeader'),
    exportWrapper: $('.export-wrapper'),
    exportDropdown: $('#exportDropdown'),
    btnExport: $('#btnExport'),
    btnUndo: $('#btnUndo'),
    btnRedo: $('#btnRedo'),
    btnReset: $('#btnReset'),
    btnZoomIn: $('#btnZoomIn'),
    btnZoomOut: $('#btnZoomOut'),
    btnFitScreen: $('#btnFitScreen'),
    btnMove: $('#btnMove'),
    zoomSlider: $('#zoomSlider'),
    statusInfo: $('#statusInfo'),
    statusSize: $('#statusSize'),
    statusZoom: $('#statusZoom'),
    tolerance: $('#tolerance'),
    toleranceVal: $('#toleranceVal'),
    brushSize: $('#brushSize'),
    brushSizeVal: $('#brushSizeVal'),
    feather: $('#feather'),
    featherVal: $('#featherVal'),
    exportFormat: $('#exportFormat'),
    exportQuality: $('#exportQuality'),
    qualityVal: $('#qualityVal'),
    qualityGroup: $('#qualityGroup'),
    cropToContent: $('#cropToContent'),
    toleranceGroup: $('#toleranceGroup'),
    brushSizeGroup: $('#brushSizeGroup'),
    brushShapeGroup: $('#brushShapeGroup'),
    featherGroup: $('#featherGroup'),
    restoreHint: $('#restoreHint'),
    loadingOverlay: $('#loadingOverlay'),
    loadingText: $('#loadingText'),
  };

  const mainCtx = dom.mainCanvas.getContext('2d', { willReadFrequently: true });
  const overlayCtx = dom.overlayCanvas.getContext('2d', { willReadFrequently: true });
  const previewCtx = dom.previewCanvas.getContext('2d', { willReadFrequently: true });

  // ===== Init =====
  function init() {
    bindEvents();
    updateToolParams();
    setStatus('就绪 - 请上传图片开始制作');
  }

  // ===== Event Binding =====
  function bindEvents() {
    // File upload
    dom.btnUpload.addEventListener('click', () => dom.fileInput.click());
    dom.btnUploadCenter.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop
    const dropArea = dom.uploadHint;
    const canvasArea = $('.canvas-area');
    ['dragenter', 'dragover'].forEach(evt => {
      canvasArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropArea) dropArea.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      canvasArea.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropArea) dropArea.classList.remove('drag-over');
      });
    });
    canvasArea.addEventListener('drop', handleDrop);

    // Tool selection (left sidebar)
    $$('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => selectTool(btn.dataset.tool));
    });

    // Canvas mouse events
    dom.overlayCanvas.addEventListener('mousedown', onCanvasMouseDown);
    dom.overlayCanvas.addEventListener('mousemove', onCanvasMouseMove);
    dom.overlayCanvas.addEventListener('mouseup', onCanvasMouseUp);
    dom.overlayCanvas.addEventListener('mouseleave', onCanvasMouseUp);
    dom.overlayCanvas.addEventListener('wheel', onCanvasWheel, { passive: false });

    // Bottom bar — view controls
    dom.btnZoomIn.addEventListener('click', () => changeZoom(0.2));
    dom.btnZoomOut.addEventListener('click', () => changeZoom(-0.2));
    dom.btnFitScreen.addEventListener('click', fitToScreen);
    dom.btnMove.addEventListener('click', () => selectTool('move'));

    // Zoom slider
    dom.zoomSlider.addEventListener('input', () => {
      state.zoom = parseInt(dom.zoomSlider.value) / 100;
      applyTransform();
      updateZoomDisplay();
    });

    // Selection action buttons
    dom.btnDeleteSelection.addEventListener('click', () => {
      removeSelectionBackground();
    });
    dom.btnCancelSelection.addEventListener('click', () => {
      clearSelection();
    });

    // Actions
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);
    dom.btnReset.addEventListener('click', resetImage);

    // Export dropdown toggle
    dom.btnExportHeader.addEventListener('click', (e) => {
      if (dom.btnExportHeader.disabled) return;
      e.stopPropagation();
      dom.exportWrapper.classList.toggle('open');
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!dom.exportWrapper.contains(e.target)) {
        dom.exportWrapper.classList.remove('open');
      }
    });

    // Export action
    dom.btnExport.addEventListener('click', () => {
      dom.exportWrapper.classList.remove('open');
      exportImage();
    });

    // Sliders
    dom.tolerance.addEventListener('input', () => {
      dom.toleranceVal.textContent = dom.tolerance.value;
    });
    dom.brushSize.addEventListener('input', () => {
      dom.brushSizeVal.textContent = dom.brushSize.value;
    });
    dom.feather.addEventListener('input', () => {
      dom.featherVal.textContent = dom.feather.value;
    });

    // Export format
    dom.exportFormat.addEventListener('change', () => {
      dom.qualityGroup.style.display =
        dom.exportFormat.value === 'png' ? 'none' : 'block';
    });
    dom.exportQuality.addEventListener('input', () => {
      dom.qualityVal.textContent = dom.exportQuality.value + '%';
    });

    // Brush shape buttons
    $$('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.brushShape = btn.dataset.shape;
      });
    });

    // Preview background
    $$('.preview-bg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.preview-bg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.previewBg = btn.dataset.bg;
        updatePreview();
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);
  }

  // ===== Keyboard Shortcuts =====
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if (key === 'y') { e.preventDefault(); redo(); }
      if (key === 's') { e.preventDefault(); exportImage(); }
      if (key === '0') { e.preventDefault(); fitToScreen(); }
      return;
    }

    switch (key) {
      case 'v': selectTool('select'); break;
      case 'l': selectTool('lasso'); break;
      case 'c': selectTool('colorpick'); break;
      case 'w': selectTool('magicwand'); break;
      case 'a': selectTool('autoremove'); break;
      case 'e': selectTool('eraser'); break;
      case 'r': selectTool('restore'); break;
      case 'h': selectTool('move'); break;
      case '+': case '=': changeZoom(0.1); break;
      case '-': changeZoom(-0.1); break;
      case 'delete': case 'backspace':
        if (state.selection) {
          e.preventDefault();
          removeSelectionBackground();
        }
        break;
      case 'escape':
        clearSelection();
        dom.exportWrapper.classList.remove('open');
        break;
    }
  }

  // ===== File Handling =====
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) loadImage(file);
    e.target.value = '';
  }

  function handleDrop(e) {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      loadImage(file);
    }
  }

  function loadImage(file) {
    showLoading('加载图片中...');
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.image = img;
        initCanvas(img);
        hideLoading();
        dom.uploadHint.style.display = 'none';
        dom.canvasContainer.style.display = 'flex';
        dom.btnExportHeader.disabled = false;
        dom.btnReset.disabled = false;
        dom.statusSize.textContent = `${img.width} × ${img.height}`;
        setStatus('图片已加载 - 选择工具开始抠图');
        fitToScreen();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ===== Canvas Setup =====
  function initCanvas(img) {
    const w = img.width;
    const h = img.height;

    dom.mainCanvas.width = w;
    dom.mainCanvas.height = h;
    dom.overlayCanvas.width = w;
    dom.overlayCanvas.height = h;

    dom.canvasWrapper.style.width = w + 'px';
    dom.canvasWrapper.style.height = h + 'px';
    dom.mainCanvas.style.position = 'relative';

    // Draw image
    mainCtx.drawImage(img, 0, 0);
    state.imageData = mainCtx.getImageData(0, 0, w, h);

    // Clone current data
    state.currentData = new ImageData(
      new Uint8ClampedArray(state.imageData.data),
      w, h
    );

    // Init mask (all visible)
    state.maskData = new Uint8Array(w * h);
    state.maskData.fill(255);

    // Reset history
    state.history = [];
    state.historyIndex = -1;
    pushHistory();

    // Update preview
    updatePreview();
  }

  function fitToScreen() {
    if (!state.image) return;
    const containerRect = dom.canvasContainer.getBoundingClientRect();
    const scaleX = (containerRect.width - 40) / state.image.width;
    const scaleY = (containerRect.height - 40) / state.image.height;
    state.zoom = Math.min(scaleX, scaleY, 1);
    state.panX = 0;
    state.panY = 0;
    applyTransform();
    updateZoomDisplay();
  }

  function applyTransform() {
    dom.canvasWrapper.style.transform =
      `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }

  function changeZoom(delta) {
    state.zoom = Math.max(0.1, Math.min(5, state.zoom + delta));
    applyTransform();
    updateZoomDisplay();
  }

  function updateZoomDisplay() {
    const pct = Math.round(state.zoom * 100);
    dom.statusZoom.textContent = pct + '%';
    dom.zoomSlider.value = pct;
  }

  // ===== Tool Selection =====
  function selectTool(tool) {
    state.tool = tool;

    // Update left sidebar buttons
    $$('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Update bottom bar move button
    dom.btnMove.classList.toggle('active', tool === 'move');

    updateToolParams();
    updateCursor();
    setStatus(getToolHint(tool));
  }

  function getToolHint(tool) {
    const hints = {
      select: '矩形选区 - 拖拽选择区域，然后按 Delete 去除背景',
      lasso: '自由套索 - 拖拽绘制自由选区',
      colorpick: '取色去背景 - 点击要去除的背景颜色区域',
      magicwand: '魔棒工具 - 点击相似颜色区域来选中并去除',
      autoremove: '自动去背景 - 点击自动检测并去除背景',
      eraser: '橡皮擦 - 拖拽擦除不需要的区域',
      restore: '恢复画笔 - 拖拽恢复被擦除的区域（在透明区域涂抹即可还原原图）',
      move: '移动画布 - 拖拽平移画布视图',
    };
    return hints[tool] || '';
  }

  function updateToolParams() {
    const tool = state.tool;
    const showTolerance = ['colorpick', 'magicwand', 'autoremove'].includes(tool);
    const showBrush = ['eraser', 'restore'].includes(tool);
    const showFeather = ['colorpick', 'magicwand', 'autoremove', 'select', 'lasso'].includes(tool);

    dom.toleranceGroup.style.display = showTolerance ? 'block' : 'none';
    dom.brushSizeGroup.style.display = showBrush ? 'block' : 'none';
    dom.brushShapeGroup.style.display = showBrush ? 'block' : 'none';
    dom.featherGroup.style.display = showFeather ? 'block' : 'none';
    dom.restoreHint.style.display = tool === 'restore' ? 'block' : 'none';
  }

  function updateCursor() {
    const cursors = {
      select: 'crosshair',
      lasso: 'crosshair',
      colorpick: 'crosshair',
      magicwand: 'crosshair',
      autoremove: 'pointer',
      eraser: 'none',
      restore: 'none',
      move: 'grab',
    };
    dom.overlayCanvas.style.cursor = cursors[state.tool] || 'default';
  }

  // ===== Canvas Interaction =====
  let paintPoints = [];
  let lassoPoints = [];

  function getCanvasCoords(e) {
    const rect = dom.overlayCanvas.getBoundingClientRect();
    // Use actual pixel ratio instead of state.zoom for precision
    const scaleX = dom.overlayCanvas.width / rect.width;
    const scaleY = dom.overlayCanvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }

  function onCanvasMouseDown(e) {
    const pos = getCanvasCoords(e);
    state.isDragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY };

    switch (state.tool) {
      case 'select':
        state.selection = { x: pos.x, y: pos.y, w: 0, h: 0 };
        break;
      case 'lasso':
        lassoPoints = [pos];
        break;
      case 'colorpick':
        removeByColor(pos.x, pos.y);
        break;
      case 'magicwand':
        magicWandSelect(pos.x, pos.y);
        break;
      case 'autoremove':
        autoRemoveBackground();
        break;
      case 'eraser':
        paintPoints = [pos];
        paintBrush(pos, false);
        break;
      case 'restore':
        paintPoints = [pos];
        paintBrush(pos, true);
        break;
      case 'move':
        dom.overlayCanvas.style.cursor = 'grabbing';
        break;
    }
  }

  function onCanvasMouseMove(e) {
    const pos = getCanvasCoords(e);

    // Show brush cursor for eraser/restore
    if (state.tool === 'eraser' || state.tool === 'restore') {
      drawBrushCursor(pos);
    }

    if (!state.isDragging) return;

    switch (state.tool) {
      case 'select': {
        const rect = dom.overlayCanvas.getBoundingClientRect();
        const scaleX = dom.overlayCanvas.width / rect.width;
        const scaleY = dom.overlayCanvas.height / rect.height;
        const sx = (state.dragStart.x - rect.left) * scaleX;
        const sy = (state.dragStart.y - rect.top) * scaleY;
        state.selection = {
          x: Math.round(Math.min(sx, pos.x)),
          y: Math.round(Math.min(sy, pos.y)),
          w: Math.round(Math.abs(pos.x - sx)),
          h: Math.round(Math.abs(pos.y - sy)),
        };
        drawSelection();
        break;
      }
      case 'lasso':
        lassoPoints.push(pos);
        drawLasso();
        break;
      case 'eraser':
        paintBrush(pos, false);
        break;
      case 'restore':
        paintBrush(pos, true);
        break;
      case 'move': {
        const dx = e.clientX - state.dragStart.x;
        const dy = e.clientY - state.dragStart.y;
        state.panX += dx;
        state.panY += dy;
        state.dragStart = { x: e.clientX, y: e.clientY };
        applyTransform();
        break;
      }
    }
  }

  function onCanvasMouseUp(e) {
    if (!state.isDragging) return;
    state.isDragging = false;

    switch (state.tool) {
      case 'select':
        if (state.selection && state.selection.w > 2 && state.selection.h > 2) {
          dom.selectionActions.style.display = 'flex';
          setStatus('选区已创建 - 点击「删除背景」或按 Delete 去除选区内背景');
        } else {
          clearSelection();
        }
        break;
      case 'lasso':
        if (lassoPoints.length > 10) {
          applyLassoSelection();
        }
        lassoPoints = [];
        clearOverlay();
        break;
      case 'eraser':
      case 'restore':
        pushHistory();
        paintPoints = [];
        break;
      case 'move':
        dom.overlayCanvas.style.cursor = 'grab';
        break;
    }
  }

  function onCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    changeZoom(delta);
  }

  // ===== Drawing / Selection =====
  function clearOverlay() {
    overlayCtx.clearRect(0, 0, dom.overlayCanvas.width, dom.overlayCanvas.height);
  }

  function drawSelection() {
    clearOverlay();
    if (!state.selection) return;
    const s = state.selection;
    overlayCtx.strokeStyle = '#6366f1';
    overlayCtx.lineWidth = 2 / state.zoom;
    overlayCtx.setLineDash([6, 4]);
    overlayCtx.strokeRect(s.x, s.y, s.w, s.h);
    overlayCtx.fillStyle = 'rgba(99, 102, 241, 0.1)';
    overlayCtx.fillRect(s.x, s.y, s.w, s.h);
    overlayCtx.setLineDash([]);
  }

  function drawLasso() {
    clearOverlay();
    if (lassoPoints.length < 2) return;
    overlayCtx.beginPath();
    overlayCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) {
      overlayCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    }
    overlayCtx.strokeStyle = '#6366f1';
    overlayCtx.lineWidth = 2 / state.zoom;
    overlayCtx.stroke();
    overlayCtx.fillStyle = 'rgba(99, 102, 241, 0.1)';
    overlayCtx.fill();
  }

  function drawBrushCursor(pos) {
    clearOverlay();
    const size = parseInt(dom.brushSize.value);
    const half = size / 2;
    const color = state.tool === 'eraser' ? '#f87171' : '#34d399';
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 1.5 / state.zoom;

    switch (state.brushShape) {
      case 'circle':
        overlayCtx.beginPath();
        overlayCtx.arc(pos.x, pos.y, half, 0, Math.PI * 2);
        overlayCtx.stroke();
        break;
      case 'square':
        overlayCtx.strokeRect(pos.x - half, pos.y - half, size, size);
        break;
      case 'line':
        overlayCtx.strokeRect(pos.x - half, pos.y - half / 3, size, size / 3);
        break;
    }
  }

  function clearSelection() {
    state.selection = null;
    clearOverlay();
    dom.selectionActions.style.display = 'none';
  }

  // ===== Background Removal: Color Pick =====
  function removeByColor(x, y) {
    if (!state.image) return;
    const w = state.image.width;
    const h = state.image.height;

    if (x < 0 || x >= w || y < 0 || y >= h) return;

    showLoading('正在去除背景色...');

    requestAnimationFrame(() => {
      const tolerance = parseInt(dom.tolerance.value);
      const featherSize = parseInt(dom.feather.value);
      const data = state.currentData.data;
      const idx = (y * w + x) * 4;
      const targetR = data[idx];
      const targetG = data[idx + 1];
      const targetB = data[idx + 2];

      for (let i = 0; i < w * h; i++) {
        const pi = i * 4;
        const dr = data[pi] - targetR;
        const dg = data[pi + 1] - targetG;
        const db = data[pi + 2] - targetB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist <= tolerance) {
          state.maskData[i] = 0;
        } else if (featherSize > 0 && dist <= tolerance + featherSize * 10) {
          const alpha = Math.round(((dist - tolerance) / (featherSize * 10)) * 255);
          state.maskData[i] = Math.min(state.maskData[i], alpha);
        }
      }

      applyMask();
      pushHistory();
      hideLoading();
      setStatus('已去除所选颜色的背景');
    });
  }

  // ===== Background Removal: Magic Wand =====
  function magicWandSelect(x, y) {
    if (!state.image) return;
    const w = state.image.width;
    const h = state.image.height;

    if (x < 0 || x >= w || y < 0 || y >= h) return;

    showLoading('魔棒选择中...');

    requestAnimationFrame(() => {
      const tolerance = parseInt(dom.tolerance.value);
      const featherSize = parseInt(dom.feather.value);
      const data = state.currentData.data;
      const visited = new Uint8Array(w * h);
      const idx = (y * w + x) * 4;
      const targetR = data[idx];
      const targetG = data[idx + 1];
      const targetB = data[idx + 2];

      // Flood fill
      const queue = [x + y * w];
      visited[y * w + x] = 1;
      const removed = [];

      while (queue.length > 0) {
        const pos = queue.pop();
        const px = pos % w;
        const py = (pos - px) / w;
        const pi = pos * 4;

        const dr = data[pi] - targetR;
        const dg = data[pi + 1] - targetG;
        const db = data[pi + 2] - targetB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist <= tolerance) {
          removed.push(pos);
          state.maskData[pos] = 0;

          // Check neighbors (4-connected)
          const neighbors = [];
          if (px > 0) neighbors.push(pos - 1);
          if (px < w - 1) neighbors.push(pos + 1);
          if (py > 0) neighbors.push(pos - w);
          if (py < h - 1) neighbors.push(pos + w);

          for (const n of neighbors) {
            if (!visited[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }
      }

      // Feather edges
      if (featherSize > 0) {
        applyFeather(featherSize);
      }

      applyMask();
      pushHistory();
      hideLoading();
      setStatus(`魔棒已去除 ${removed.length} 个像素`);
    });
  }

  // ===== Background Removal: Auto =====
  function autoRemoveBackground() {
    if (!state.image) return;
    showLoading('自动检测背景中...');

    requestAnimationFrame(() => {
      const w = state.image.width;
      const h = state.image.height;
      const tolerance = parseInt(dom.tolerance.value);
      const featherSize = parseInt(dom.feather.value);
      const data = state.currentData.data;

      // Sample corners and edges for background color detection
      const samples = [];
      const samplePoints = [
        [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
        [Math.floor(w / 2), 0], [0, Math.floor(h / 2)],
        [w - 1, Math.floor(h / 2)], [Math.floor(w / 2), h - 1],
      ];

      // Also sample along edges
      const step = Math.max(1, Math.floor(Math.min(w, h) / 20));
      for (let x = 0; x < w; x += step) {
        samples.push({ x, y: 0 });
        samples.push({ x, y: h - 1 });
      }
      for (let y = 0; y < h; y += step) {
        samples.push({ x: 0, y });
        samples.push({ x: w - 1, y });
      }

      for (const p of samplePoints) {
        samples.push({ x: p[0], y: p[1] });
      }

      // Find most common background color
      const colorMap = {};
      for (const s of samples) {
        const i = (s.y * w + s.x) * 4;
        // Quantize color to reduce noise
        const r = Math.round(data[i] / 8) * 8;
        const g = Math.round(data[i + 1] / 8) * 8;
        const b = Math.round(data[i + 2] / 8) * 8;
        const key = `${r},${g},${b}`;
        colorMap[key] = (colorMap[key] || 0) + 1;
      }

      let maxCount = 0;
      let bgColor = '255,255,255';
      for (const key in colorMap) {
        if (colorMap[key] > maxCount) {
          maxCount = colorMap[key];
          bgColor = key;
        }
      }

      const [bgR, bgG, bgB] = bgColor.split(',').map(Number);

      // Flood fill from all edges using BFS
      const visited = new Uint8Array(w * h);
      const queue = [];

      // Add all edge pixels
      for (let x = 0; x < w; x++) {
        queue.push(x); // top row
        queue.push((h - 1) * w + x); // bottom row
      }
      for (let y = 0; y < h; y++) {
        queue.push(y * w); // left column
        queue.push(y * w + w - 1); // right column
      }

      // Mark edge pixels as visited
      for (const pos of queue) visited[pos] = 1;

      let removedCount = 0;

      while (queue.length > 0) {
        const pos = queue.shift();
        const pi = pos * 4;
        const px = pos % w;
        const py = (pos - px) / w;

        const dr = data[pi] - bgR;
        const dg = data[pi + 1] - bgG;
        const db = data[pi + 2] - bgB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        const effectiveTolerance = tolerance + 15; // Slightly more permissive for auto mode

        if (dist <= effectiveTolerance) {
          state.maskData[pos] = 0;
          removedCount++;

          const neighbors = [];
          if (px > 0) neighbors.push(pos - 1);
          if (px < w - 1) neighbors.push(pos + 1);
          if (py > 0) neighbors.push(pos - w);
          if (py < h - 1) neighbors.push(pos + w);

          for (const n of neighbors) {
            if (!visited[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }
      }

      // Apply feathering
      if (featherSize > 0) {
        applyFeather(featherSize);
      }

      applyMask();
      pushHistory();
      hideLoading();
      setStatus(`自动去除了 ${removedCount} 个背景像素`);
    });
  }

  // ===== Selection-Based Removal =====
  function removeSelectionBackground() {
    if (!state.selection || !state.image) return;

    const sel = state.selection;
    const w = state.image.width;
    const h = state.image.height;
    const tolerance = parseInt(dom.tolerance.value);
    const featherSize = parseInt(dom.feather.value);
    const data = state.currentData.data;

    showLoading('去除选区背景中...');

    requestAnimationFrame(() => {
      // Sample border of selection for background color
      const samples = [];
      const step = Math.max(1, Math.floor(Math.min(sel.w, sel.h) / 20));

      for (let x = sel.x; x < sel.x + sel.w; x += step) {
        if (x >= 0 && x < w) {
          if (sel.y >= 0 && sel.y < h) samples.push((sel.y * w + x) * 4);
          const by = sel.y + sel.h - 1;
          if (by >= 0 && by < h) samples.push((by * w + x) * 4);
        }
      }
      for (let y = sel.y; y < sel.y + sel.h; y += step) {
        if (y >= 0 && y < h) {
          if (sel.x >= 0 && sel.x < w) samples.push((y * w + sel.x) * 4);
          const bx = sel.x + sel.w - 1;
          if (bx >= 0 && bx < w) samples.push((y * w + bx) * 4);
        }
      }

      // Average the border colors
      let avgR = 0, avgG = 0, avgB = 0;
      for (const i of samples) {
        avgR += data[i];
        avgG += data[i + 1];
        avgB += data[i + 2];
      }
      avgR = Math.round(avgR / samples.length);
      avgG = Math.round(avgG / samples.length);
      avgB = Math.round(avgB / samples.length);

      // Remove matching colors within selection
      const x1 = Math.max(0, sel.x);
      const y1 = Math.max(0, sel.y);
      const x2 = Math.min(w, sel.x + sel.w);
      const y2 = Math.min(h, sel.y + sel.h);

      for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
          const i = y * w + x;
          const pi = i * 4;
          const dr = data[pi] - avgR;
          const dg = data[pi + 1] - avgG;
          const db = data[pi + 2] - avgB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);

          if (dist <= tolerance) {
            state.maskData[i] = 0;
          } else if (featherSize > 0 && dist <= tolerance + featherSize * 10) {
            const alpha = Math.round(((dist - tolerance) / (featherSize * 10)) * 255);
            state.maskData[i] = Math.min(state.maskData[i], alpha);
          }
        }
      }

      clearSelection();
      applyMask();
      pushHistory();
      hideLoading();
      setStatus('选区内背景已去除');
    });
  }

  // ===== Lasso Selection =====
  function applyLassoSelection() {
    if (!state.image || lassoPoints.length < 3) return;

    showLoading('应用套索选区...');
    requestAnimationFrame(() => {
      const w = state.image.width;
      const h = state.image.height;

      // Find bounding box
      let minX = w, minY = h, maxX = 0, maxY = 0;
      for (const p of lassoPoints) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(w - 1, maxX);
      maxY = Math.min(h - 1, maxY);

      // Remove pixels outside lasso (within bounding box)
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isPointInPolygon(x, y, lassoPoints)) {
            state.maskData[y * w + x] = 0;
          }
        }
      }

      // Also remove everything outside the bounding box
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x < minX || x > maxX || y < minY || y > maxY) {
            state.maskData[y * w + x] = 0;
          }
        }
      }

      const featherSize = parseInt(dom.feather.value);
      if (featherSize > 0) {
        applyFeather(featherSize);
      }

      applyMask();
      pushHistory();
      hideLoading();
      setStatus('套索区域外的内容已去除');
    });
  }

  function isPointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ===== Brush (Eraser / Restore) — supports circle, square, line shapes =====
  function paintBrush(pos, isRestore) {
    if (!state.image) return;
    const w = state.image.width;
    const h = state.image.height;
    const size = parseInt(dom.brushSize.value);
    const half = size / 2;
    const shape = state.brushShape;

    // Determine bounding box based on shape
    let x1, y1, x2, y2;
    if (shape === 'line') {
      // Horizontal line: full width, narrow height
      const lineH = Math.max(1, size / 3);
      x1 = Math.max(0, Math.floor(pos.x - half));
      y1 = Math.max(0, Math.floor(pos.y - lineH / 2));
      x2 = Math.min(w - 1, Math.ceil(pos.x + half));
      y2 = Math.min(h - 1, Math.ceil(pos.y + lineH / 2));
    } else {
      x1 = Math.max(0, Math.floor(pos.x - half));
      y1 = Math.max(0, Math.floor(pos.y - half));
      x2 = Math.min(w - 1, Math.ceil(pos.x + half));
      y2 = Math.min(h - 1, Math.ceil(pos.y + half));
    }

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const dx = x - pos.x;
        const dy = y - pos.y;
        let inBrush = false;
        let edgeFactor = 1; // 1 = fully inside, 0 = fully outside

        switch (shape) {
          case 'circle': {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= half) {
              inBrush = true;
              // Soft edge for outer 20%
              if (dist > half * 0.8) {
                edgeFactor = (half - dist) / (half * 0.2);
              }
            }
            break;
          }
          case 'square': {
            if (Math.abs(dx) <= half && Math.abs(dy) <= half) {
              inBrush = true;
              // Soft edge for outer 15%
              const edgeDist = Math.min(half - Math.abs(dx), half - Math.abs(dy));
              const softZone = half * 0.15;
              if (edgeDist < softZone) {
                edgeFactor = edgeDist / softZone;
              }
            }
            break;
          }
          case 'line': {
            const lineH = Math.max(1, size / 3);
            if (Math.abs(dx) <= half && Math.abs(dy) <= lineH / 2) {
              inBrush = true;
              // Soft edge on ends
              const edgeDistX = half - Math.abs(dx);
              const edgeDistY = lineH / 2 - Math.abs(dy);
              const softZone = Math.min(half, lineH / 2) * 0.2;
              const minEdge = Math.min(edgeDistX, edgeDistY);
              if (minEdge < softZone && softZone > 0) {
                edgeFactor = minEdge / softZone;
              }
            }
            break;
          }
        }

        if (inBrush) {
          const i = y * w + x;
          if (isRestore) {
            const restoreAlpha = Math.round(edgeFactor * 255);
            state.maskData[i] = Math.max(state.maskData[i], restoreAlpha);
          } else {
            const eraseAlpha = Math.round((1 - edgeFactor) * 255);
            state.maskData[i] = Math.min(state.maskData[i], eraseAlpha);
          }
        }
      }
    }

    applyMask();
  }

  // ===== Feathering =====
  function applyFeather(radius) {
    if (radius <= 0 || !state.image) return;
    const w = state.image.width;
    const h = state.image.height;
    const mask = state.maskData;

    // Find edge pixels (border between transparent and opaque)
    const edgePixels = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] > 0) {
          // Check if any neighbor is transparent
          if (mask[i - 1] === 0 || mask[i + 1] === 0 ||
              mask[i - w] === 0 || mask[i + w] === 0) {
            edgePixels.push(i);
          }
        }
      }
    }

    // Apply gaussian-like feathering around edges
    const featherRadius = radius * 2;
    for (const edgeIdx of edgePixels) {
      const ex = edgeIdx % w;
      const ey = (edgeIdx - ex) / w;

      for (let dy = -featherRadius; dy <= featherRadius; dy++) {
        for (let dx = -featherRadius; dx <= featherRadius; dx++) {
          const nx = ex + dx;
          const ny = ey + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= featherRadius && mask[ni] > 0) {
            const alpha = Math.round((dist / featherRadius) * 255);
            if (alpha < mask[ni]) {
              mask[ni] = Math.max(alpha, mask[ni] > 128 ? Math.round(alpha * 0.5 + mask[ni] * 0.5) : alpha);
            }
          }
        }
      }
    }
  }

  // ===== Apply Mask to Canvas =====
  function applyMask() {
    if (!state.image) return;
    const w = state.image.width;
    const h = state.image.height;

    // Build displayed image data from original + mask
    const display = new ImageData(
      new Uint8ClampedArray(state.imageData.data),
      w, h
    );

    for (let i = 0; i < w * h; i++) {
      display.data[i * 4 + 3] = state.maskData[i];
    }

    state.currentData = display;
    mainCtx.clearRect(0, 0, w, h);
    mainCtx.putImageData(display, 0, 0);
    updatePreview();
  }

  // ===== Preview =====
  function updatePreview() {
    if (!state.image) return;

    const pw = dom.previewCanvas.width = dom.previewCanvas.clientWidth * 2;
    const ph = dom.previewCanvas.height = 300;

    previewCtx.clearRect(0, 0, pw, ph);

    // Draw background
    switch (state.previewBg) {
      case 'white':
        previewCtx.fillStyle = '#ffffff';
        previewCtx.fillRect(0, 0, pw, ph);
        break;
      case 'black':
        previewCtx.fillStyle = '#1a1a1a';
        previewCtx.fillRect(0, 0, pw, ph);
        break;
      case 'green':
        previewCtx.fillStyle = '#00b140';
        previewCtx.fillRect(0, 0, pw, ph);
        break;
      case 'checkerboard':
      default:
        drawCheckerboard(previewCtx, pw, ph, 10);
        break;
    }

    // Fit image in preview
    const scale = Math.min(pw / state.image.width, ph / state.image.height);
    const dw = state.image.width * scale;
    const dh = state.image.height * scale;
    const dx = (pw - dw) / 2;
    const dy = (ph - dh) / 2;

    // Create temp canvas with current image data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = state.image.width;
    tempCanvas.height = state.image.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(state.currentData, 0, 0);

    previewCtx.drawImage(tempCanvas, dx, dy, dw, dh);
  }

  function drawCheckerboard(ctx, w, h, size) {
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c0c0c0';
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  }

  // ===== History (Undo/Redo) =====
  function pushHistory() {
    // Remove future history if we branched
    state.history = state.history.slice(0, state.historyIndex + 1);

    // Save mask state
    state.history.push(new Uint8Array(state.maskData));
    state.historyIndex = state.history.length - 1;

    // Limit history size
    if (state.history.length > state.maxHistory) {
      state.history.shift();
      state.historyIndex--;
    }

    updateHistoryButtons();
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    state.maskData = new Uint8Array(state.history[state.historyIndex]);
    applyMask();
    updateHistoryButtons();
    setStatus('已撤销');
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    state.maskData = new Uint8Array(state.history[state.historyIndex]);
    applyMask();
    updateHistoryButtons();
    setStatus('已重做');
  }

  function resetImage() {
    if (!state.image) return;
    state.maskData.fill(255);
    applyMask();
    pushHistory();
    clearSelection();
    setStatus('图片已重置');
  }

  function updateHistoryButtons() {
    dom.btnUndo.disabled = state.historyIndex <= 0;
    dom.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
  }

  // ===== Export =====
  function exportImage() {
    if (!state.image) return;
    showLoading('正在导出图片...');

    requestAnimationFrame(() => {
      const format = dom.exportFormat.value;
      const quality = parseInt(dom.exportQuality.value) / 100;
      const cropToContent = dom.cropToContent.checked;

      let exportCanvas = document.createElement('canvas');
      let exportCtx = exportCanvas.getContext('2d');

      const w = state.image.width;
      const h = state.image.height;

      // Find content bounds if cropping
      let x1 = 0, y1 = 0, x2 = w, y2 = h;
      if (cropToContent) {
        x1 = w; y1 = h; x2 = 0; y2 = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (state.maskData[y * w + x] > 0) {
              x1 = Math.min(x1, x);
              y1 = Math.min(y1, y);
              x2 = Math.max(x2, x + 1);
              y2 = Math.max(y2, y + 1);
            }
          }
        }
        if (x1 >= x2 || y1 >= y2) {
          hideLoading();
          setStatus('没有可导出的内容');
          return;
        }
        // Add small padding
        const pad = 2;
        x1 = Math.max(0, x1 - pad);
        y1 = Math.max(0, y1 - pad);
        x2 = Math.min(w, x2 + pad);
        y2 = Math.min(h, y2 + pad);
      }

      const cw = x2 - x1;
      const ch = y2 - y1;
      exportCanvas.width = cw;
      exportCanvas.height = ch;

      // For JPG, fill white background first
      if (format === 'jpg') {
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, cw, ch);
      }

      // Create export image data
      const srcData = state.currentData;
      const exportData = exportCtx.createImageData(cw, ch);

      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const srcIdx = ((y + y1) * w + (x + x1)) * 4;
          const dstIdx = (y * cw + x) * 4;
          exportData.data[dstIdx] = srcData.data[srcIdx];
          exportData.data[dstIdx + 1] = srcData.data[srcIdx + 1];
          exportData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
          exportData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
        }
      }

      if (format === 'jpg') {
        // Composite onto white background for JPG
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cw;
        tempCanvas.height = ch;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(exportData, 0, 0);

        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, cw, ch);
        exportCtx.drawImage(tempCanvas, 0, 0);
      } else {
        exportCtx.putImageData(exportData, 0, 0);
      }

      // Generate and download
      const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
      const ext = format === 'jpg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';

      exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `特效素材_${Date.now()}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        hideLoading();
        setStatus(`图片已导出为 ${ext.toUpperCase()} 格式 (${cw}×${ch})`);
      }, mimeType, format === 'png' ? undefined : quality);
    });
  }

  // ===== Utility =====
  function showLoading(text) {
    dom.loadingText.textContent = text || '处理中...';
    dom.loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    dom.loadingOverlay.style.display = 'none';
  }

  function setStatus(text) {
    dom.statusInfo.textContent = text;
  }

  // ===== Start =====
  init();
})();
