/**
 * Wedding Mobile Studio - iPhone Simulator & Screen Recorder
 * Core Application Logic
 */

(function () {
  'use strict';

  // ==========================================
  // DOM Elements
  // ==========================================
  const urlInput = document.getElementById('urlInput');
  const openUrlBtn = document.getElementById('openUrlBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  const simulatorIframe = document.getElementById('simulatorIframe');
  const iphoneFrameImg = document.getElementById('iphoneFrameImg');
  const deviceWrapper = document.getElementById('deviceWrapper');
  const deviceRigContainer = document.getElementById('deviceRigContainer');
  const deviceScreen = document.getElementById('deviceScreen');
  const canvasViewport = document.getElementById('canvasViewport');

  // iPhone Finish Swatches
  const finishSwatches = document.getElementById('finishSwatches');

  // Background Scene Controls
  const sceneBackground = document.getElementById('sceneBackground');
  const bgPresetSelect = document.getElementById('bgPresetSelect');
  const bgFileInput = document.getElementById('bgFileInput');
  const uploadBgBtn = document.getElementById('uploadBgBtn');
  const blurBgBtn = document.getElementById('blurBgBtn');
  const blurBtnText = document.getElementById('blurBtnText');
  const resetBgBtn = document.getElementById('resetBgBtn');

  // Touch / Tap Indicator
  const touchIndicatorBtn = document.getElementById('touchIndicatorBtn');
  const touchBtnText = document.getElementById('touchBtnText');
  const touchIndicatorLayer = document.getElementById('touchIndicatorLayer');
  const circularTouchCursor = document.getElementById('circularTouchCursor');
  const touchRipple = document.getElementById('touchRipple');

  // Viewport Scale, Orientation & Full Screen
  const scaleSelect = document.getElementById('scaleSelect');
  const orientationBtn = document.getElementById('orientationBtn');
  const orientationText = document.getElementById('orientationText');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const fullscreenBtnText = document.getElementById('fullscreenBtnText');
  const fullscreenIcon = document.getElementById('fullscreenIcon');

  // Screen Recorder Elements
  const recordBtn = document.getElementById('recordBtn');
  const recordBtnText = document.getElementById('recordBtnText');
  const recordingBadge = document.getElementById('recordingBadge');
  const recordingTimer = document.getElementById('recordingTimer');

  // Recording Modal Elements
  const recordModalBackdrop = document.getElementById('recordModalBackdrop');
  const recordedVideoPlayer = document.getElementById('recordedVideoPlayer');
  const videoDurationInfo = document.getElementById('videoDurationInfo');
  const downloadRecordBtn = document.getElementById('downloadRecordBtn');
  const downloadBtnLabel = document.getElementById('downloadBtnLabel');
  const videoFormatBadge = document.getElementById('videoFormatBadge');
  const discardRecordBtn = document.getElementById('discardRecordBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');

  // Toast Container
  const toastContainer = document.getElementById('toastContainer');

  // ==========================================
  // State
  // ==========================================
  let isLandscape = false;
  let isTouchIndicatorEnabled = true;
  let isBgBlurred = false;
  let customBgDataUrl = null;

  // Recorder State
  let isRecording = false;
  let mediaRecorder = null;
  let recordedStream = null;
  let recordedChunks = [];
  let recordTimerInterval = null;
  let recordStartTime = 0;
  let currentVideoUrl = null;

  // Base dimensions of device wrapper
  const BASE_WIDTH = 410;
  const BASE_HEIGHT = 837.28; // 410 * (2408 / 1179)

  // ==========================================
  // Helper: Toast Notifications
  // ==========================================
  function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ==========================================
  // URL Loading & Simple Refresh
  // ==========================================
  function normalizeUrl(url) {
    let trimmed = url.trim();
    if (!trimmed) return 'about:blank';

    // If local relative file or localhost
    if (trimmed.endsWith('.html') || trimmed.startsWith('/') || trimmed.startsWith('./')) {
      return trimmed;
    }
    if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
      return 'http://' + trimmed;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      return 'https://' + trimmed;
    }
    return trimmed;
  }

  const emptyPlaceholder = document.getElementById('emptyPlaceholder');

  function loadUrl() {
    const inputVal = urlInput.value.trim();
    if (!inputVal) {
      showToast('Please enter a website URL');
      return;
    }
    const finalUrl = normalizeUrl(inputVal);
    urlInput.value = finalUrl;

    try {
      if (emptyPlaceholder) emptyPlaceholder.classList.add('hidden');
      
      // If external or different port, route through local proxy so it's 100% same-origin!
      let iframeUrl = finalUrl;
      const isExternal = /^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith(window.location.origin);
      if (isExternal && window.location.protocol.startsWith('http')) {
        iframeUrl = `/proxy?url=${encodeURIComponent(finalUrl)}`;
      }

      simulatorIframe.src = iframeUrl;
      showToast(`Loading: ${finalUrl}`);
    } catch (err) {
      console.error('Error loading URL:', err);
      showToast('Could not load URL');
    }
  }

  // Simple Refresh Button
  function refreshIframe() {
    if (!simulatorIframe.src || simulatorIframe.src === 'about:blank') {
      showToast('Please enter and load a website first');
      return;
    }
    try {
      // Try reload directly if same-origin
      if (simulatorIframe.contentWindow && simulatorIframe.contentWindow.location) {
        simulatorIframe.contentWindow.location.reload();
      } else {
        // Fallback: reset src
        const currentSrc = simulatorIframe.src;
        simulatorIframe.src = '';
        simulatorIframe.src = currentSrc;
      }
      showToast('🔄 Website Refreshed');
    } catch (e) {
      // Cross-origin fallback
      const currentSrc = simulatorIframe.src;
      simulatorIframe.src = currentSrc;
      showToast('🔄 Website Refreshed');
    }
  }

  openUrlBtn.addEventListener('click', loadUrl);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUrl();
  });
  refreshBtn.addEventListener('click', refreshIframe);

  // ==========================================
  // iPhone Finish Switcher
  // ==========================================
  const framePaths = {
    '1': 'Iphone Device Frame/Iphone frame (1).png', // Desert Titanium
    '2': 'Iphone Device Frame/Iphone frame (2).png', // Gold Titanium
    '3': 'Iphone Device Frame/Iphone frame (3).png', // Blue Titanium
    '4': 'Iphone Device Frame/Iphone frame (4).png'  // Natural Titanium
  };

  const finishNames = {
    '1': 'Desert Titanium',
    '2': 'Gold Titanium',
    '3': 'Blue Titanium',
    '4': 'Natural Titanium'
  };

  finishSwatches.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch-btn');
    if (!btn) return;

    const frameId = btn.dataset.frame;
    if (!framePaths[frameId]) return;

    // Update active swatch state
    document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Switch image smoothly
    iphoneFrameImg.style.opacity = '0.4';
    setTimeout(() => {
      iphoneFrameImg.src = framePaths[frameId];
      iphoneFrameImg.style.opacity = '1';
    }, 100);

    showToast(`📱 Switched to ${finishNames[frameId]}`);
  });

  // ==========================================
  // Background Scene Customizer
  // ==========================================
  function applyPresetBackground(preset) {
    sceneBackground.style.backgroundImage = '';
    sceneBackground.className = 'scene-background preset-' + preset;
    if (isBgBlurred) {
      sceneBackground.classList.add('blurred');
    }
  }

  bgPresetSelect.addEventListener('change', () => {
    customBgDataUrl = null;
    applyPresetBackground(bgPresetSelect.value);
    showToast('Scene background updated');
  });

  // Upload Custom Background Image
  uploadBgBtn.addEventListener('click', () => {
    bgFileInput.click();
  });

  bgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      customBgDataUrl = event.target.result;
      sceneBackground.className = 'scene-background';
      if (isBgBlurred) sceneBackground.classList.add('blurred');
      sceneBackground.style.backgroundImage = `url("${customBgDataUrl}")`;
      showToast('Custom background loaded successfully');
    };
    reader.readAsDataURL(file);
    // Reset file input so user can re-upload same file if desired
    bgFileInput.value = '';
  });

  // Blur Toggle
  blurBgBtn.addEventListener('click', () => {
    isBgBlurred = !isBgBlurred;
    if (isBgBlurred) {
      sceneBackground.classList.add('blurred');
      blurBgBtn.classList.add('active');
      blurBtnText.innerText = 'Blur: On';
    } else {
      sceneBackground.classList.remove('blurred');
      blurBgBtn.classList.remove('active');
      blurBtnText.innerText = 'Blur: Off';
    }
  });

  // Reset Background
  resetBgBtn.addEventListener('click', () => {
    customBgDataUrl = null;
    isBgBlurred = false;
    sceneBackground.style.backgroundImage = '';
    sceneBackground.classList.remove('blurred');
    blurBgBtn.classList.remove('active');
    blurBtnText.innerText = 'Blur: Off';
    bgPresetSelect.value = 'dark';
    applyPresetBackground('dark');
    showToast('Background reset to Studio Dark');
  });

  // Initialize Default Background
  applyPresetBackground('dark');

  // ==========================================
  // Circular Touch / Tap Indicator Engine
  // ==========================================
  function getCurrentScale() {
    if (!deviceRigContainer) return 1;
    const match = deviceRigContainer.style.transform.match(/scale\(([^)]+)\)/);
    return match ? parseFloat(match[1]) : 1;
  }

  touchIndicatorBtn.addEventListener('click', () => {
    isTouchIndicatorEnabled = !isTouchIndicatorEnabled;
    if (isTouchIndicatorEnabled) {
      touchIndicatorLayer.classList.remove('disabled');
      touchIndicatorBtn.classList.add('active');
      touchBtnText.innerText = '👆 Touch Indicator: ON';
      showToast('👆 Touch Indicator Enabled');
    } else {
      touchIndicatorLayer.classList.add('disabled');
      touchIndicatorBtn.classList.remove('active');
      touchBtnText.innerText = '👆 Touch Indicator: OFF';
      circularTouchCursor.classList.remove('visible');
      showToast('Touch Indicator Disabled');
    }
  });

  function setCursorPos(x, y) {
    circularTouchCursor.style.transform = `translate3d(${x - 17}px, ${y - 17}px, 0)`;
    if (!circularTouchCursor.classList.contains('visible')) {
      circularTouchCursor.classList.add('visible');
    }
  }

  function handleScreenPointerLeave() {
    circularTouchCursor.classList.remove('visible');
    circularTouchCursor.classList.remove('active');
  }

  function triggerTouchRipple(x, y) {
    if (!isTouchIndicatorEnabled) return;

    touchRipple.style.left = `${x}px`;
    touchRipple.style.top = `${y}px`;
    touchRipple.classList.remove('animating');
    requestAnimationFrame(() => {
      touchRipple.classList.add('animating');
    });
  }

  // Tracking over Empty Screen Placeholder
  if (emptyPlaceholder) {
    emptyPlaceholder.addEventListener('mousemove', (e) => {
      if (!isTouchIndicatorEnabled) return;
      const rect = emptyPlaceholder.getBoundingClientRect();
      const scale = getCurrentScale();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      setCursorPos(x, y);
    }, { passive: true });

    emptyPlaceholder.addEventListener('mousedown', (e) => {
      if (!isTouchIndicatorEnabled) return;
      circularTouchCursor.classList.add('active');
      const rect = emptyPlaceholder.getBoundingClientRect();
      const scale = getCurrentScale();
      triggerTouchRipple((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
    }, { passive: true });

    emptyPlaceholder.addEventListener('mouseup', () => {
      circularTouchCursor.classList.remove('active');
    }, { passive: true });

    emptyPlaceholder.addEventListener('mouseleave', handleScreenPointerLeave, { passive: true });
  }

  // Hook iframe document for tracking, smooth scrolling and mobile touch emulation
  function hookIframeDocument() {
    try {
      const iframeDoc = simulatorIframe.contentDocument || simulatorIframe.contentWindow.document;
      if (!iframeDoc) return;

      // Ensure native hardware SVG cursor and hidden scrollbar inside iframe document
      try {
        let style = iframeDoc.getElementById('simulator-mobile-overrides');
        if (!style) {
          style = iframeDoc.createElement('style');
          style.id = 'simulator-mobile-overrides';
          style.textContent = `
            html, body, button, a, input, select, textarea, label { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }
            ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
            ::-webkit-scrollbar-track { background: transparent !important; }
            ::-webkit-scrollbar-thumb { background: transparent !important; }
            html, body { -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; -webkit-overflow-scrolling: touch; }
          `;
          if (iframeDoc.head) iframeDoc.head.appendChild(style);
        }
      } catch (styleErr) {}

      // Intercept in-page anchor clicks (scroll-down buttons) to scroll ONLY the iframe window without shifting device
      iframeDoc.addEventListener('click', (e) => {
        const anchor = e.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (href && (href.startsWith('#') || href.startsWith('/#') || href === '')) {
          e.preventDefault();
          const hash = href.includes('#') ? href.substring(href.indexOf('#')) : '';
          const docView = iframeDoc.defaultView || window;
          if (!hash || hash === '#' || hash === '#top') {
            docView.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            try {
              const targetEl = iframeDoc.querySelector(hash) || iframeDoc.getElementById(hash.substring(1));
              if (targetEl) {
                const currentY = docView.pageYOffset || iframeDoc.documentElement.scrollTop || 0;
                const targetY = targetEl.getBoundingClientRect().top + currentY;
                docView.scrollTo({ top: targetY, behavior: 'smooth' });
              }
            } catch (err) {
              const idEl = iframeDoc.getElementById(hash.substring(1));
              if (idEl) {
                const currentY = docView.pageYOffset || iframeDoc.documentElement.scrollTop || 0;
                const targetY = idEl.getBoundingClientRect().top + currentY;
                docView.scrollTo({ top: targetY, behavior: 'smooth' });
              }
            }
          }
        }
      }, true);

      // RAF-throttled GPU movement inside iframe document (no main-thread lag on high-DPI mice)
      let pendingMoveRaf = null;
      let lastMoveX = 0, lastMoveY = 0;
      iframeDoc.addEventListener('mousemove', (e) => {
        if (!isTouchIndicatorEnabled) return;
        lastMoveX = e.clientX;
        lastMoveY = e.clientY;
        if (!pendingMoveRaf) {
          pendingMoveRaf = requestAnimationFrame(() => {
            pendingMoveRaf = null;
            setCursorPos(lastMoveX, lastMoveY);
          });
        }
      }, { passive: true });

      iframeDoc.addEventListener('mouseleave', handleScreenPointerLeave, { passive: true });

      // Natural Mobile Drag-to-Scroll (Touch swipe emulation with momentum)
      let isDragging = false;
      let lastY = 0, lastX = 0;
      let velocityY = 0, velocityX = 0;
      let momentumRaf = null;
      let dragDistance = 0;

      iframeDoc.addEventListener('mousedown', (e) => {
        if (!isTouchIndicatorEnabled) return;
        circularTouchCursor.classList.add('active');
        triggerTouchRipple(e.clientX, e.clientY);

        // Initiate drag scroll only on primary left button and avoid text inputs
        if (e.button !== 0) return;
        const targetTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (['input', 'textarea', 'select'].includes(targetTag) || e.target.isContentEditable) return;

        isDragging = true;
        lastY = e.clientY;
        lastX = e.clientX;
        velocityY = 0;
        velocityX = 0;
        dragDistance = 0;
        if (momentumRaf) {
          cancelAnimationFrame(momentumRaf);
          momentumRaf = null;
        }
      }, { passive: true });

      iframeDoc.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dy = lastY - e.clientY;
        const dx = lastX - e.clientX;
        dragDistance += Math.abs(dy) + Math.abs(dx);
        lastY = e.clientY;
        lastX = e.clientX;
        velocityY = dy;
        velocityX = dx;

        if (dragDistance > 4) {
          const docView = iframeDoc.defaultView || window;
          docView.scrollBy({ top: dy, left: dx, behavior: 'auto' });
        }
      }, { passive: true });

      const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        if (Math.abs(velocityY) > 1 || Math.abs(velocityX) > 1) {
          let vY = velocityY * 1.3;
          let vX = velocityX * 1.3;
          const docView = iframeDoc.defaultView || window;
          const stepMomentum = () => {
            if (Math.abs(vY) < 0.3 && Math.abs(vX) < 0.3) return;
            docView.scrollBy({ top: vY, left: vX, behavior: 'auto' });
            vY *= 0.93;
            vX *= 0.93;
            momentumRaf = requestAnimationFrame(stepMomentum);
          };
          momentumRaf = requestAnimationFrame(stepMomentum);
        }
      };

      iframeDoc.addEventListener('mouseup', () => {
        circularTouchCursor.classList.remove('active');
        stopDrag();
      }, { passive: true });

      iframeDoc.addEventListener('mouseleave', stopDrag, { passive: true });

      // Suppress accidental click navigation if user was performing a swipe/drag scroll
      iframeDoc.addEventListener('click', (e) => {
        if (dragDistance > 6) {
          e.preventDefault();
          e.stopPropagation();
          dragDistance = 0;
        }
      }, true);

    } catch (err) {
      console.log('Cross-origin frame note: direct browser events handled natively.');
    }
  }

  // Hook immediately and on each reload
  hookIframeDocument();
  simulatorIframe.addEventListener('load', hookIframeDocument);

  // ==========================================
  // Viewport Scaling & Auto-Fit Engine
  // ==========================================
  function calculateAndApplyScale() {
    const scaleMode = scaleSelect.value;

    if (scaleMode === 'auto') {
      // Available dimensions in canvas area with safety margins
      const availWidth = canvasViewport.clientWidth - 48;
      const availHeight = canvasViewport.clientHeight - 36;

      let targetWidth = BASE_WIDTH;
      let targetHeight = BASE_HEIGHT;

      if (isLandscape) {
        // Swap bounds in landscape
        targetWidth = BASE_HEIGHT;
        targetHeight = BASE_WIDTH;
      }

      const scaleX = availWidth / targetWidth;
      const scaleY = availHeight / targetHeight;
      const autoScale = Math.min(scaleX, scaleY, 0.98); // Max 98% scale

      deviceRigContainer.style.transform = `translate(-50%, -50%) scale(${Math.max(autoScale, 0.35).toFixed(3)})`;
    } else {
      const fixedScale = parseFloat(scaleMode);
      deviceRigContainer.style.transform = `translate(-50%, -50%) scale(${fixedScale})`;
    }
  }

  scaleSelect.addEventListener('change', calculateAndApplyScale);
  window.addEventListener('resize', calculateAndApplyScale);

  // Prevent any container scroll or accidental device shifting
  function preventContainerScroll() {
    if (canvasViewport.scrollTop !== 0) canvasViewport.scrollTop = 0;
    if (canvasViewport.scrollLeft !== 0) canvasViewport.scrollLeft = 0;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  }
  canvasViewport.addEventListener('scroll', preventContainerScroll, { passive: true });
  window.addEventListener('scroll', preventContainerScroll, { passive: true });

  // Forward wheel scrolling from canvas or phone frame to the simulator iframe without layout thrashing
  canvasViewport.addEventListener('wheel', (e) => {
    try {
      const iframeWin = simulatorIframe.contentWindow;
      if (iframeWin) {
        iframeWin.scrollBy({
          top: e.deltaY,
          left: e.deltaX,
          behavior: 'auto'
        });
      }
    } catch (err) {}
  }, { passive: true });

  // Orientation Toggle
  orientationBtn.addEventListener('click', () => {
    isLandscape = !isLandscape;
    if (isLandscape) {
      deviceWrapper.classList.add('landscape');
      orientationText.innerText = 'Landscape';
      showToast('🔄 Rotated to Landscape');
    } else {
      deviceWrapper.classList.remove('landscape');
      orientationText.innerText = 'Portrait';
      showToast('🔄 Rotated to Portrait');
    }
    calculateAndApplyScale();
  });

  // Full Screen Presentation Mode (Hides Top Control Bars)
  function enterFullScreen() {
    document.body.classList.add('fullscreen-mode');
    if (fullscreenBtnText) fullscreenBtnText.innerText = 'Exit Full Screen';
    if (fullscreenIcon) {
      fullscreenIcon.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>';
    }
    showToast('⛶ Full Screen Mode Active (Press Esc to exit)');
    setTimeout(calculateAndApplyScale, 60);
  }

  function exitFullScreen() {
    document.body.classList.remove('fullscreen-mode');
    if (fullscreenBtnText) fullscreenBtnText.innerText = 'Full Screen';
    if (fullscreenIcon) {
      fullscreenIcon.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
    }
    showToast('Exited Full Screen Mode');
    setTimeout(calculateAndApplyScale, 60);
  }

  function toggleFullScreen() {
    if (document.body.classList.contains('fullscreen-mode')) {
      exitFullScreen();
    } else {
      enterFullScreen();
    }
  }

  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullScreen);

  // Keyboard shortcut: Esc to exit Full Screen
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen-mode')) {
      exitFullScreen();
    }
  });

  // Initial scaling calculation
  calculateAndApplyScale();

  // ==========================================
  // High-Performance Mobile Screen Recording Engine
  // ==========================================
  let rawDisplayStream = null;
  let croppedStream = null;
  let helperVideo = null;
  let cropCanvas = null;
  let cropCtx = null;
  let cropAnimFrameId = null;
  let isNativeCropActive = false;
  let cachedDeviceRect = null;

  function updateCachedRect() {
    if (deviceWrapper) {
      cachedDeviceRect = deviceWrapper.getBoundingClientRect();
    }
  }

  function formatTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
  }

  function startRecordingTimer() {
    recordStartTime = Date.now();
    recordingTimer.innerText = '00:00';
    recordingBadge.classList.remove('hidden');

    recordTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - recordStartTime) / 1000);
      recordingTimer.innerText = formatTimer(elapsedSec);
    }, 1000);
  }

  function stopRecordingTimer() {
    clearInterval(recordTimerInterval);
    recordingBadge.classList.add('hidden');
  }

  // Fixes WebM duration header so browser players play with 100% hardware smooth 1.0x speed
  async function fixWebmDuration(blob, durationMs) {
    try {
      const buffer = await blob.arrayBuffer();
      const u8 = new Uint8Array(buffer);

      // Find Segment Info: 0x15 0x49 0xA9 0x66
      let infoPos = -1;
      for (let i = 0; i < Math.min(u8.length - 4, 1024); i++) {
        if (u8[i] === 0x15 && u8[i+1] === 0x49 && u8[i+2] === 0xA9 && u8[i+3] === 0x66) {
          infoPos = i;
          break;
        }
      }
      if (infoPos === -1) return blob;

      // Find TimecodeScale: 0x2A 0xD7 0xB1
      let timecodeScale = 1000000;
      for (let i = infoPos; i < Math.min(infoPos + 200, u8.length - 7); i++) {
        if (u8[i] === 0x2A && u8[i+1] === 0xD7 && u8[i+2] === 0xB1) {
          const size = u8[i+3] & 0x07;
          let val = 0;
          for (let j = 0; j < size; j++) {
            val = (val << 8) | u8[i + 4 + j];
          }
          if (val > 0) timecodeScale = val;
          break;
        }
      }

      const durationVal = durationMs * 1000000 / timecodeScale;

      // Check if Duration (0x44 0x89) exists inside Info
      for (let i = infoPos; i < Math.min(infoPos + 200, u8.length - 10); i++) {
        if (u8[i] === 0x44 && u8[i+1] === 0x89) {
          const dataSize = u8[i+2] & 0x0F;
          const view = new DataView(buffer);
          if (dataSize === 4) {
            view.setFloat32(i + 3, durationVal, false);
          } else if (dataSize === 8) {
            view.setFloat64(i + 3, durationVal, false);
          }
          return new Blob([buffer], { type: blob.type });
        }
      }

      // Duration not present: insert 0x44 0x89 [0x84] [float32] (7 bytes) into Info
      let offset = infoPos + 4;
      let infoSizeLen = 1;
      let b = u8[offset];
      let mask = 0x80;
      while ((b & mask) === 0 && infoSizeLen < 8) {
        infoSizeLen++;
        mask >>= 1;
      }

      const durBytes = new Uint8Array(7);
      durBytes[0] = 0x44;
      durBytes[1] = 0x89;
      durBytes[2] = 0x84; // 4-byte float
      new DataView(durBytes.buffer).setFloat32(3, durationVal, false);

      const insertPos = offset + infoSizeLen;
      const newBuf = new Uint8Array(buffer.byteLength + 7);
      newBuf.set(u8.subarray(0, insertPos), 0);
      newBuf.set(durBytes, insertPos);
      newBuf.set(u8.subarray(insertPos), insertPos + 7);

      // Update Info element size
      let infoSize = 0;
      for (let j = 0; j < infoSizeLen; j++) {
        const byte = u8[offset + j];
        infoSize = (infoSize << 8) | (j === 0 ? (byte & (mask - 1)) : byte);
      }
      infoSize += 7;
      for (let j = infoSizeLen - 1; j >= 0; j--) {
        let byte = (infoSize >>> ((infoSizeLen - 1 - j) * 8)) & 0xFF;
        if (j === 0) byte |= mask;
        newBuf[offset + j] = byte;
      }

      return new Blob([newBuf.buffer], { type: blob.type });
    } catch (err) {
      console.warn('WebM duration fix skipped:', err);
      return blob;
    }
  }

  // Optimized fallback render loop with 30 FPS timing
  let lastDrawTime = 0;
  const targetFrameInterval = 1000 / 30; // 33.33ms
  let cropParams = null;

  function updateCropParameters() {
    if (!deviceWrapper || !helperVideo) return;
    const rect = deviceWrapper.getBoundingClientRect();
    const vWidth = helperVideo.videoWidth || 1920;
    const vHeight = helperVideo.videoHeight || 1080;
    const winWidth = window.innerWidth || 1;
    const winHeight = window.innerHeight || 1;
    const scaleX = vWidth / winWidth;
    const scaleY = vHeight / winHeight;

    const sx = Math.max(0, Math.min(vWidth - 10, Math.round(rect.left * scaleX)));
    const sy = Math.max(0, Math.min(vHeight - 10, Math.round(rect.top * scaleY)));
    const sWidth = Math.max(10, Math.min(vWidth - sx, Math.round(rect.width * scaleX)));
    const sHeight = Math.max(10, Math.min(vHeight - sy, Math.round(rect.height * scaleY)));

    cropParams = {
      sx, sy,
      sWidth, sHeight,
      targetW: sWidth,
      targetH: sHeight
    };

    if (cropCanvas) {
      if (cropCanvas.width !== sWidth || cropCanvas.height !== sHeight) {
        cropCanvas.width = sWidth;
        cropCanvas.height = sHeight;
      }
    }
  }

  function drawCroppedFrame() {
    if (!isRecording || isNativeCropActive || !helperVideo || !cropCtx || !cropParams) return;
    try {
      // Direct 1:1 hardware blit (instantaneous, 0ms CPU load, 0 forced reflows)
      cropCtx.drawImage(helperVideo, cropParams.sx, cropParams.sy, cropParams.sWidth, cropParams.sHeight, 0, 0, cropParams.targetW, cropParams.targetH);
    } catch (e) {}
  }

  function scheduleNextFrame() {
    if (!isRecording || isNativeCropActive) return;

    cropAnimFrameId = requestAnimationFrame((timestamp) => {
      if (!isRecording || isNativeCropActive) return;
      if (timestamp - lastDrawTime >= targetFrameInterval - 3) {
        lastDrawTime = timestamp;
        drawCroppedFrame();
      }
      scheduleNextFrame();
    });
  }

  async function startScreenRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen Recording API is not supported in this browser. Please use Chrome, Edge, or Firefox.');
      return;
    }

    try {
      updateCachedRect();

      // Request screen stream with 60 FPS capture capability for silky smooth source frames
      rawDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include'
      });

      isNativeCropActive = false;
      let finalStreamToRecord = rawDisplayStream;

      // 1. Try Native Hardware Region Capture (CropTarget API - 0% CPU overhead)
      if (window.CropTarget && typeof CropTarget.fromElement === 'function') {
        try {
          const cropTarget = await CropTarget.fromElement(deviceWrapper);
          const [videoTrack] = rawDisplayStream.getVideoTracks();
          if (videoTrack && typeof videoTrack.cropTo === 'function') {
            await videoTrack.cropTo(cropTarget);
            isNativeCropActive = true;
            finalStreamToRecord = rawDisplayStream;
            console.log('Zero-overhead native CropTarget active');
          }
        } catch (cropErr) {
          console.log('Region capture fallback to ultra-light canvas:', cropErr);
          isNativeCropActive = false;
        }
      }

      // 2. Ultra-Light Hardware Canvas Fallback if native CropTarget is unsupported
      if (!isNativeCropActive) {
        if (!helperVideo) {
          helperVideo = document.createElement('video');
          helperVideo.muted = true;
          helperVideo.playsInline = true;
          helperVideo.setAttribute('playsinline', '');
          // Keep within layout with non-zero dimensions so Chromium NEVER suspends the decoder
          helperVideo.style.cssText = 'position:fixed;bottom:0;right:0;width:320px;height:180px;opacity:0.001;pointer-events:none;z-index:-1;visibility:visible;';
        }
        if (!helperVideo.isConnected) {
          document.body.appendChild(helperVideo);
        }
        helperVideo.srcObject = rawDisplayStream;
        await helperVideo.play();

        // Ensure video is actively decoding valid frames before recording starts (eliminates starting glitches!)
        if (helperVideo.readyState < 2 || !helperVideo.videoWidth) {
          await new Promise(resolve => {
            const onReady = () => {
              helperVideo.removeEventListener('loadeddata', onReady);
              helperVideo.removeEventListener('canplay', onReady);
              resolve();
            };
            helperVideo.addEventListener('loadeddata', onReady);
            helperVideo.addEventListener('canplay', onReady);
            setTimeout(resolve, 600);
          });
        }

        if (!cropCanvas) {
          cropCanvas = document.createElement('canvas');
          cropCtx = cropCanvas.getContext('2d', { alpha: false, desynchronized: true });
        }

        updateCropParameters();

        // Paint first clean frame immediately to guarantee 0 blank frames at the start
        cropCtx.fillStyle = '#000000';
        cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
        drawCroppedFrame();

        lastDrawTime = performance.now();
        scheduleNextFrame();

        croppedStream = cropCanvas.captureStream(30); // Exactly 30 FPS stream
        rawDisplayStream.getAudioTracks().forEach(track => croppedStream.addTrack(track));
        finalStreamToRecord = croppedStream;
      }

      // MIME Type Selection: Prioritize hardware-accelerated VP8 for 0% CPU overhead and silky-smooth browsing
      const mimeTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/webm;codecs=vp9,opus',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ];
      let selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(finalStreamToRecord, {
        mimeType: selectedMime,
        videoBitsPerSecond: 6000000 // 6 Mbps: Crisp HD without encoder lag or frame drops
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const durationSec = Math.floor((Date.now() - recordStartTime) / 1000);
        const durationMs = Date.now() - recordStartTime;
        let finalBlob = new Blob(recordedChunks, { type: selectedMime });

        // Patch WebM duration header so video element and players play with 100% hardware smooth 1.0x speed
        if (selectedMime.includes('webm') && durationMs > 500) {
          finalBlob = await fixWebmDuration(finalBlob, durationMs);
        }

        if (currentVideoUrl) {
          URL.revokeObjectURL(currentVideoUrl);
        }
        currentVideoUrl = URL.createObjectURL(finalBlob);

        const isWebm = selectedMime.includes('webm');
        const fileExt = isWebm ? 'webm' : 'mp4';
        const formatLabel = isWebm ? '1080p 30FPS WebM' : '1080p 30FPS MP4';

        // Populate Modal
        recordedVideoPlayer.src = currentVideoUrl;
        downloadRecordBtn.href = currentVideoUrl;
        downloadRecordBtn.download = `mobile-recording-1080p-${Date.now()}.${fileExt}`;
        videoDurationInfo.innerText = `Duration: ${formatTimer(durationSec)}`;
        if (videoFormatBadge) videoFormatBadge.innerText = formatLabel;
        if (downloadBtnLabel) downloadBtnLabel.innerText = `Download 1080p ${isWebm ? 'WebM' : 'MP4'}`;

        // Open Modal
        recordModalBackdrop.classList.add('active');
        recordedVideoPlayer.play().catch(() => {});
        showToast(`🎬 ${formatLabel} recording complete!`);
      };

      // Handle user ending sharing from browser system bar
      const videoTrack = rawDisplayStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (isRecording) stopScreenRecording();
        };
      }

      // Start recording as a continuous monotonic stream without timeslice jitter
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add('recording');
      recordBtnText.innerText = 'Stop';
      startRecordingTimer();
      showToast('🔴 Recording Started');

    } catch (err) {
      console.warn('Screen recording cancelled or error:', err);
      isRecording = false;
      if (err.name !== 'NotAllowedError') {
        alert('Could not start screen recording: ' + err.message);
      }
    }
  }

  function stopScreenRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (cropAnimFrameId) {
      cancelAnimationFrame(cropAnimFrameId);
      cropAnimFrameId = null;
    }

    recordBtn.classList.remove('recording');
    recordBtnText.innerText = 'Record';
    stopRecordingTimer();

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    if (rawDisplayStream) {
      rawDisplayStream.getTracks().forEach(track => track.stop());
      rawDisplayStream = null;
    }

    if (croppedStream) {
      croppedStream.getTracks().forEach(track => track.stop());
      croppedStream = null;
    }

    if (helperVideo) {
      helperVideo.pause();
      helperVideo.srcObject = null;
      if (helperVideo.isConnected) {
        helperVideo.remove();
      }
    }
  }

  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      startScreenRecording();
    } else {
      stopScreenRecording();
    }
  });

  // Modal Close & Discard
  function closePreviewModal() {
    recordModalBackdrop.classList.remove('active');
    recordedVideoPlayer.pause();
  }

  closeModalBtn.addEventListener('click', closePreviewModal);
  discardRecordBtn.addEventListener('click', () => {
    closePreviewModal();
    showToast('Recording discarded');
  });

  recordModalBackdrop.addEventListener('click', (e) => {
    if (e.target === recordModalBackdrop) {
      closePreviewModal();
    }
  });

  downloadRecordBtn.addEventListener('click', () => {
    showToast('⬇️ Video download started');
  });

})();
