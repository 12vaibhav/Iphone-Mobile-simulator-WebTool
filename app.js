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

  // iPhone 16 Pro Finish Swatches
  const finishSwatches = document.getElementById('finishSwatches');

  // Background Scene Controls
  const sceneBackground = document.getElementById('sceneBackground');
  const bgPresetSelect = document.getElementById('bgPresetSelect');
  const bgFileInput = document.getElementById('bgFileInput');
  const uploadBgBtn = document.getElementById('uploadBgBtn');
  const blurBgBtn = document.getElementById('blurBgBtn');
  const blurBtnText = document.getElementById('blurBtnText');
  const resetBgBtn = document.getElementById('resetBgBtn');

  // Touch / Tap Indicator Layer (Always ON)
  const touchIndicatorLayer = document.getElementById('touchIndicatorLayer');
  const circularTouchCursor = document.getElementById('circularTouchCursor');
  const touchRipple = document.getElementById('touchRipple');

  // Viewport Scale, Tilt & Full Screen
  const scaleSelect = document.getElementById('scaleSelect');
  const tiltBtn = document.getElementById('tiltBtn');
  const tiltBtnText = document.getElementById('tiltBtnText');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const fullscreenBtnText = document.getElementById('fullscreenBtnText');
  const fullscreenIcon = document.getElementById('fullscreenIcon');

  // Screen Recorder Elements
  const recordBtn = document.getElementById('recordBtn');
  const recordBtnText = document.getElementById('recordBtnText');
  const recordingBadge = document.getElementById('recordingBadge');
  const recordingTimer = document.getElementById('recordingTimer');

  // 9:16 Interactive Crop Viewfinder Elements
  const recordingCropFrame = document.getElementById('recordingCropFrame');
  const cropOverlayContainer = document.getElementById('cropOverlayContainer');
  const cropBox = document.getElementById('cropBox');
  const cropGrid = document.getElementById('cropGrid');
  const cropSnapBtn = document.getElementById('cropSnapBtn');
  const cropConfirmBtn = document.getElementById('cropConfirmBtn');
  const cropCancelBtn = document.getElementById('cropCancelBtn');
  const cropActionBar = document.getElementById('cropActionBar');

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
  let isTouchIndicatorEnabled = true;
  let isBgBlurred = false;
  let customBgDataUrl = null;

  // Recorder State (1080p 30FPS VP9 WebM)
  let isRecording = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let currentVideoUrl = null;
  let recordTimerInterval = null;
  let recordStartTime = 0;

  // iPhone 16 Pro Finishes & Dimensions
  const IPHONE_16_PRO_FINISHES = {
    'desert': { name: 'Desert Titanium', label: 'Desert', cssClass: 'finish-desert', src: 'Iphone Device Frame/iPhone_16_Pro (1).png' },
    'white':  { name: 'White Titanium',  label: 'White',  cssClass: 'finish-white',  src: 'Iphone Device Frame/iPhone_16_Pro (2).png' },
    'crimson':{ name: 'Crimson Titanium',label: 'Crimson',cssClass: 'finish-crimson',src: 'Iphone Device Frame/iPhone_16_Pro (3).png' },
    'blue':   { name: 'Deep Blue Titanium',label: 'Blue', cssClass: 'finish-deepblue',src: 'Iphone Device Frame/iPhone_16_Pro (4).png' }
  };

  let currentFinish = 'desert';

  const BASE_WIDTH = 410;
  const BASE_HEIGHT = 820;

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
    if (refreshBtn) {
      const svg = refreshBtn.querySelector('svg');
      if (svg) {
        svg.classList.remove('spinning');
        void svg.offsetWidth;
        svg.classList.add('spinning');
        setTimeout(() => svg.classList.remove('spinning'), 600);
      }
    }

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
  // iPhone 16 Pro Finish Switcher
  // ==========================================
  finishSwatches.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch-btn');
    if (!btn) return;

    const frameId = btn.dataset.frame;
    if (!IPHONE_16_PRO_FINISHES[frameId]) return;

    currentFinish = frameId;

    finishSwatches.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    iphoneFrameImg.style.opacity = '0.4';
    setTimeout(() => {
      iphoneFrameImg.src = IPHONE_16_PRO_FINISHES[frameId].src;
      iphoneFrameImg.style.opacity = '1';
    }, 100);

    showToast(`📱 Finish: ${IPHONE_16_PRO_FINISHES[frameId].name}`);
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

      // Handle touch cursor press and ripple without moving or scrolling the screen
      iframeDoc.addEventListener('mousedown', (e) => {
        if (!isTouchIndicatorEnabled) return;
        circularTouchCursor.classList.add('active');
        triggerTouchRipple(e.clientX, e.clientY);
      }, { passive: true });

      iframeDoc.addEventListener('mouseup', () => {
        circularTouchCursor.classList.remove('active');
      }, { passive: true });

      // Prevent native ghost image/link dragging while dragging the cursor across the screen
      iframeDoc.addEventListener('dragstart', (e) => {
        e.preventDefault();
      });

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

      const targetWidth = BASE_WIDTH;
      const targetHeight = BASE_HEIGHT;

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

  // ==========================================
  // 10-Degree Device Tilt Feature (Left / Right / Reset)
  // ==========================================
  let currentTilt = 0; // 0: Straight, -10: Left, 10: Right

  if (tiltBtn) {
    tiltBtn.addEventListener('click', () => {
      if (currentTilt === 0) {
        // Rotate slightly to the left side (by 10 degree)
        currentTilt = -10;
        deviceWrapper.classList.remove('tilt-right');
        deviceWrapper.classList.add('tilt-left');
        tiltBtn.classList.add('active');
        if (tiltBtnText) tiltBtnText.innerText = 'Tilt: -10° (Left)';
        showToast('📐 Rotated 10° Left');
      } else if (currentTilt === -10) {
        // Another click: rotate to the right side (by 10 degree)
        currentTilt = 10;
        deviceWrapper.classList.remove('tilt-left');
        deviceWrapper.classList.add('tilt-right');
        tiltBtn.classList.add('active');
        if (tiltBtnText) tiltBtnText.innerText = 'Tilt: +10° (Right)';
        showToast('📐 Rotated 10° Right');
      } else {
        // Return to neutral straight orientation (0 degree)
        currentTilt = 0;
        deviceWrapper.classList.remove('tilt-left', 'tilt-right');
        tiltBtn.classList.remove('active');
        if (tiltBtnText) tiltBtnText.innerText = 'Tilt: 0°';
        showToast('📐 Reset Rotation (0°)');
      }

      if (cropOverlayContainer && cropOverlayContainer.classList.contains('active')) {
        setTimeout(snapCropToDevice, 360);
      }
    });
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
  // High-Performance Mobile Screen Recording Engine (9:16 Crop Enabled)
  // ==========================================
  let rawDisplayStream = null;
  let croppedStream = null;
  let croppedTrack = null;
  let helperVideo = null;
  let cropCanvas = null;
  let cropCtx = null;
  let cropAnimFrameId = null;
  let isNativeCropActive = false;
  let cachedDeviceRect = null;

  // 9:16 Crop Selection State
  let activeCropRect = null;
  let wasCropped916 = false;
  const CROP_ASPECT_RATIO = 9 / 16; // 0.5625
  let cropAnchor = {
    isSnapped: true,
    relX: 0,
    relY: 0,
    width: 0,
    height: 0
  };
  let recordingResizeObserver = null;

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

  // ==========================================
  // 9:16 Interactive Crop Viewfinder Logic
  // ==========================================
  function snapCropToDevice() {
    if (!cropBox || !deviceWrapper || !canvasViewport) return;
    const vpRect = canvasViewport.getBoundingClientRect();
    const devRect = deviceWrapper.getBoundingClientRect();

    // Available space inside viewport with margin
    const maxW = Math.max(200, vpRect.width - 32);
    const maxH = Math.max(350, vpRect.height - 32);

    // Enclose phone with generous aesthetic framing padding (never cut off phone edges)
    const pad = 36;
    let targetH = devRect.height + pad * 2;
    let targetW = targetH * CROP_ASPECT_RATIO;

    if (targetW < devRect.width + pad * 2) {
      targetW = devRect.width + pad * 2;
      targetH = targetW / CROP_ASPECT_RATIO;
    }

    // Center over deviceWrapper relative to canvasViewport
    const devCenterRelX = (devRect.left + devRect.width / 2) - vpRect.left;
    const devCenterRelY = (devRect.top + devRect.height / 2) - vpRect.top;

    let left = devCenterRelX - targetW / 2;
    let top = devCenterRelY - targetH / 2;

    // Clamp inside viewport
    left = Math.max(8, Math.min(vpRect.width - targetW - 8, left));
    top = Math.max(8, Math.min(vpRect.height - targetH - 8, top));

    cropBox.style.width = `${Math.round(targetW)}px`;
    cropBox.style.height = `${Math.round(targetH)}px`;
    cropBox.style.left = `${Math.round(left)}px`;
    cropBox.style.top = `${Math.round(top)}px`;

    cropAnchor = {
      isSnapped: true,
      relX: 0,
      relY: 0,
      width: Math.round(targetW),
      height: Math.round(targetH)
    };

    syncRecordingCropFrame();
    updateCropDimensionsUI();
    checkActionBarFlip();
  }

  function realignCropToDevice() {
    if (!cropBox || !deviceWrapper || !canvasViewport) return;
    if (!cropAnchor || cropAnchor.isSnapped) {
      snapCropToDevice();
      return;
    }

    const vpRect = canvasViewport.getBoundingClientRect();
    const devRect = deviceWrapper.getBoundingClientRect();

    const devCenterRelX = (devRect.left + devRect.width / 2) - vpRect.left;
    const devCenterRelY = (devRect.top + devRect.height / 2) - vpRect.top;

    const targetW = cropAnchor.width || cropBox.offsetWidth;
    const targetH = cropAnchor.height || cropBox.offsetHeight;

    let left = (devCenterRelX + (cropAnchor.relX || 0)) - targetW / 2;
    let top = (devCenterRelY + (cropAnchor.relY || 0)) - targetH / 2;

    left = Math.max(0, Math.min(vpRect.width - targetW, left));
    top = Math.max(0, Math.min(vpRect.height - targetH, top));

    cropBox.style.width = `${Math.round(targetW)}px`;
    cropBox.style.height = `${Math.round(targetH)}px`;
    cropBox.style.left = `${Math.round(left)}px`;
    cropBox.style.top = `${Math.round(top)}px`;

    syncRecordingCropFrame();
  }

  function syncRecordingCropFrame() {
    if (!recordingCropFrame || !cropBox) return;
    if (!cropBox.style.width || parseFloat(cropBox.style.width) === 0) {
      snapCropToDevice();
      return;
    }
    recordingCropFrame.style.width = cropBox.style.width;
    recordingCropFrame.style.height = cropBox.style.height;
    recordingCropFrame.style.left = cropBox.style.left;
    recordingCropFrame.style.top = cropBox.style.top;
  }

  function updateCropDimensionsUI() {
    // 30FPS VP9 WebM mode active
  }

  function checkActionBarFlip() {
    if (!cropActionBar || !cropBox || !canvasViewport) return;
    const top = parseFloat(cropBox.style.top) || 0;
    const height = parseFloat(cropBox.style.height) || 0;
    const vpHeight = canvasViewport.clientHeight;

    if (top + height + 68 > vpHeight) {
      cropActionBar.classList.add('flip-top');
    } else {
      cropActionBar.classList.remove('flip-top');
    }
  }

  function openCropViewfinder() {
    if (!cropOverlayContainer || !cropBox) return;
    cropOverlayContainer.classList.add('active');
    snapCropToDevice();
    showToast('📐 Frame your 9:16 Reel & click "Start 9:16 Record"', 3000);
  }

  function closeCropViewfinder() {
    if (!cropOverlayContainer) return;
    cropOverlayContainer.classList.remove('active');
  }

  // --- Dragging the Crop Box ---
  let isDraggingCrop = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialBoxLeft = 0;
  let initialBoxTop = 0;

  if (cropBox) {
    cropBox.addEventListener('pointerdown', (e) => {
      // Don't drag if clicking resize handle, action bar, or child buttons
      if (e.target.closest('.crop-handle') || e.target.closest('.crop-action-bar')) return;
      isDraggingCrop = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      initialBoxLeft = parseFloat(cropBox.style.left) || 0;
      initialBoxTop = parseFloat(cropBox.style.top) || 0;
      cropBox.classList.add('dragging');
      cropBox.setPointerCapture(e.pointerId);
    });

    cropBox.addEventListener('pointermove', (e) => {
      if (!isDraggingCrop || !canvasViewport) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const vpWidth = canvasViewport.clientWidth;
      const vpHeight = canvasViewport.clientHeight;
      const boxW = cropBox.offsetWidth;
      const boxH = cropBox.offsetHeight;

      let newLeft = initialBoxLeft + dx;
      let newTop = initialBoxTop + dy;

      newLeft = Math.max(0, Math.min(vpWidth - boxW, newLeft));
      newTop = Math.max(0, Math.min(vpHeight - boxH, newTop));

      cropBox.style.left = `${Math.round(newLeft)}px`;
      cropBox.style.top = `${Math.round(newTop)}px`;

      syncRecordingCropFrame();
      checkActionBarFlip();
    });

    const endDrag = (e) => {
      if (!isDraggingCrop) return;
      isDraggingCrop = false;
      cropBox.classList.remove('dragging');
      try { cropBox.releasePointerCapture(e.pointerId); } catch (err) {}

      if (deviceWrapper && canvasViewport) {
        const vpRect = canvasViewport.getBoundingClientRect();
        const devRect = deviceWrapper.getBoundingClientRect();
        const devCenterRelX = (devRect.left + devRect.width / 2) - vpRect.left;
        const devCenterRelY = (devRect.top + devRect.height / 2) - vpRect.top;
        const boxCenterX = (parseFloat(cropBox.style.left) || 0) + cropBox.offsetWidth / 2;
        const boxCenterY = (parseFloat(cropBox.style.top) || 0) + cropBox.offsetHeight / 2;

        cropAnchor = {
          isSnapped: false,
          relX: boxCenterX - devCenterRelX,
          relY: boxCenterY - devCenterRelY,
          width: cropBox.offsetWidth,
          height: cropBox.offsetHeight
        };
      }
    };

    cropBox.addEventListener('pointerup', endDrag);
    cropBox.addEventListener('pointercancel', endDrag);
  }

  // --- Resizing the Crop Box (Strict 9:16 Aspect Ratio) ---
  let activeResizeHandle = null;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let initialResizeLeft = 0;
  let initialResizeTop = 0;
  let initialResizeW = 0;
  let initialResizeH = 0;

  const cropHandles = cropOverlayContainer ? cropOverlayContainer.querySelectorAll('.crop-handle') : [];
  cropHandles.forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activeResizeHandle = handle.dataset.handle;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      initialResizeLeft = parseFloat(cropBox.style.left) || 0;
      initialResizeTop = parseFloat(cropBox.style.top) || 0;
      initialResizeW = cropBox.offsetWidth;
      initialResizeH = cropBox.offsetHeight;

      cropBox.classList.add('resizing');
      handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!activeResizeHandle || !canvasViewport) return;
      const dx = e.clientX - resizeStartX;
      const dy = e.clientY - resizeStartY;
      const vpWidth = canvasViewport.clientWidth;
      const vpHeight = canvasViewport.clientHeight;

      let newW = initialResizeW;
      let newH = initialResizeH;
      let newLeft = initialResizeLeft;
      let newTop = initialResizeTop;

      const MIN_W = 180;

      if (activeResizeHandle === 'br') {
        const delta = Math.abs(dx) > Math.abs(dy * CROP_ASPECT_RATIO) ? dx : (dy * CROP_ASPECT_RATIO);
        newW = Math.max(MIN_W, initialResizeW + delta);
        newH = newW / CROP_ASPECT_RATIO;
        if (newLeft + newW > vpWidth) {
          newW = vpWidth - newLeft;
          newH = newW / CROP_ASPECT_RATIO;
        }
        if (newTop + newH > vpHeight) {
          newH = vpHeight - newTop;
          newW = newH * CROP_ASPECT_RATIO;
        }
      } else if (activeResizeHandle === 'tr') {
        const delta = Math.abs(dx) > Math.abs(dy * CROP_ASPECT_RATIO) ? dx : (-dy * CROP_ASPECT_RATIO);
        newW = Math.max(MIN_W, initialResizeW + delta);
        newH = newW / CROP_ASPECT_RATIO;
        newTop = initialResizeTop - (newH - initialResizeH);
        if (newTop < 0) {
          newTop = 0;
          newH = initialResizeTop + initialResizeH;
          newW = newH * CROP_ASPECT_RATIO;
        }
        if (newLeft + newW > vpWidth) {
          newW = vpWidth - newLeft;
          newH = newW / CROP_ASPECT_RATIO;
          newTop = initialResizeTop - (newH - initialResizeH);
        }
      } else if (activeResizeHandle === 'bl') {
        const delta = Math.abs(dx) > Math.abs(dy * CROP_ASPECT_RATIO) ? -dx : (dy * CROP_ASPECT_RATIO);
        newW = Math.max(MIN_W, initialResizeW + delta);
        newH = newW / CROP_ASPECT_RATIO;
        newLeft = initialResizeLeft - (newW - initialResizeW);
        if (newLeft < 0) {
          newLeft = 0;
          newW = initialResizeLeft + initialResizeW;
          newH = newW / CROP_ASPECT_RATIO;
        }
        if (newTop + newH > vpHeight) {
          newH = vpHeight - newTop;
          newW = newH * CROP_ASPECT_RATIO;
          newLeft = initialResizeLeft - (newW - initialResizeW);
        }
      } else if (activeResizeHandle === 'tl') {
        const delta = Math.abs(dx) > Math.abs(dy * CROP_ASPECT_RATIO) ? -dx : (-dy * CROP_ASPECT_RATIO);
        newW = Math.max(MIN_W, initialResizeW + delta);
        newH = newW / CROP_ASPECT_RATIO;
        newLeft = initialResizeLeft - (newW - initialResizeW);
        newTop = initialResizeTop - (newH - initialResizeH);
        if (newLeft < 0) {
          newLeft = 0;
          newW = initialResizeLeft + initialResizeW;
          newH = newW / CROP_ASPECT_RATIO;
          newTop = initialResizeTop - (newH - initialResizeH);
        }
        if (newTop < 0) {
          newTop = 0;
          newH = initialResizeTop + initialResizeH;
          newW = newH * CROP_ASPECT_RATIO;
          newLeft = initialResizeLeft - (newW - initialResizeW);
        }
      }

      cropBox.style.width = `${Math.round(newW)}px`;
      cropBox.style.height = `${Math.round(newH)}px`;
      cropBox.style.left = `${Math.round(newLeft)}px`;
      cropBox.style.top = `${Math.round(newTop)}px`;

      syncRecordingCropFrame();
      updateCropDimensionsUI();
      checkActionBarFlip();
    });

    const endResize = (e) => {
      if (!activeResizeHandle) return;
      activeResizeHandle = null;
      cropBox.classList.remove('resizing');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}

      if (deviceWrapper && canvasViewport) {
        const vpRect = canvasViewport.getBoundingClientRect();
        const devRect = deviceWrapper.getBoundingClientRect();
        const devCenterRelX = (devRect.left + devRect.width / 2) - vpRect.left;
        const devCenterRelY = (devRect.top + devRect.height / 2) - vpRect.top;
        const boxCenterX = (parseFloat(cropBox.style.left) || 0) + cropBox.offsetWidth / 2;
        const boxCenterY = (parseFloat(cropBox.style.top) || 0) + cropBox.offsetHeight / 2;

        cropAnchor = {
          isSnapped: false,
          relX: boxCenterX - devCenterRelX,
          relY: boxCenterY - devCenterRelY,
          width: cropBox.offsetWidth,
          height: cropBox.offsetHeight
        };
      }
    };

    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
  });

  // Buttons in Crop Action Bar
  if (cropSnapBtn) {
    cropSnapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      snapCropToDevice();
      showToast('🎯 Snapped 9:16 frame to iPhone');
    });
  }

  if (cropCancelBtn) {
    cropCancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeCropViewfinder();
      activeCropRect = null;
    });
  }

  if (cropConfirmBtn) {
    cropConfirmBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!cropBox) return;

      syncRecordingCropFrame();

      const boxRect = cropBox.getBoundingClientRect();
      activeCropRect = {
        left: boxRect.left + 2,
        top: boxRect.top + 2,
        width: boxRect.width - 4,
        height: boxRect.height - 4
      };

      // Hide overlay so NO dotted lines, handles, or scrim are rendered into the capture!
      closeCropViewfinder();

      // Start the actual screen recording
      await startScreenRecording();
    });
  }

  // Detect best supported WebM codec (VP9 prioritized for maximum visual quality)
  function getSupportedWebmMime() {
    const webmCandidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp09.00.10.08',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    return webmCandidates.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || 'video/webm';
  }

  // ==========================================
  // NATIVE REGION CAPTURE & FALLBACK LOGIC
  // ==========================================

  async function startScreenRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen Recording API is not supported in this browser. Please use Chrome, Edge, or Firefox.');
      return;
    }

    try {
      syncRecordingCropFrame();
      wasCropped916 = true;

      // Pure display capture
      rawDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 60 }
        },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude'
      });

      // Wait 350ms for browser sharing infobar animation to settle
      await new Promise(resolve => setTimeout(resolve, 350));

      const videoTrack = rawDisplayStream.getVideoTracks()[0];
      croppedStream = null;

      // NATIVE GPU CROP (Zero-Stutter Region Capture API)
      if (typeof CropTarget !== 'undefined' && videoTrack.cropTo) {
        try {
          const cropTarget = await CropTarget.fromElement(recordingCropFrame);
          await videoTrack.cropTo(cropTarget);
          croppedStream = rawDisplayStream;
          console.log('Region Capture API (cropTo) successfully initialized.');
          
          // CRITICAL FIX: Wait for the browser to actually apply the crop to the stream.
          // If we start MediaRecorder immediately, it records the first frame at 1920x1080.
          // When the crop kicks in, the resolution changes mid-stream, causing players to zoom/stretch.
          const tempVideo = document.createElement('video');
          tempVideo.muted = true;
          tempVideo.srcObject = croppedStream;
          await tempVideo.play().catch(() => {});
          await new Promise(resolve => {
            // Wait for resolution change or fallback timeout
            let isResolved = false;
            const finish = () => {
              if (isResolved) return;
              isResolved = true;
              tempVideo.removeEventListener('resize', finish);
              tempVideo.pause();
              tempVideo.srcObject = null;
              resolve();
            };
            tempVideo.addEventListener('resize', finish);
            setTimeout(finish, 800); // Max wait time
          });
          
        } catch (e) {
          console.warn('cropTo failed, falling back to canvas', e);
        }
      } 
      
      // HIGH-PERFORMANCE FALLBACK (requestVideoFrameCallback)
      if (!croppedStream) {
        console.log('Using requestVideoFrameCallback fallback for cropping.');
        if (!helperVideo) {
          helperVideo = document.createElement('video');
          helperVideo.muted = true;
          helperVideo.playsInline = true;
          helperVideo.setAttribute('playsinline', '');
          helperVideo.style.cssText = 'position:fixed;bottom:10px;right:10px;width:160px;height:90px;opacity:0.01;pointer-events:none;z-index:-9999;';
        }
        if (!helperVideo.isConnected) {
          document.body.appendChild(helperVideo);
        }
        helperVideo.srcObject = rawDisplayStream;
        await helperVideo.play().catch(e => console.warn('Helper video play:', e));
        
        await new Promise(resolve => {
          if (helperVideo.readyState >= 2 && helperVideo.videoWidth > 0) return resolve();
          const onReady = () => {
             if (helperVideo.readyState >= 2 && helperVideo.videoWidth > 0) {
               helperVideo.removeEventListener('loadeddata', onReady);
               resolve();
             }
          };
          helperVideo.addEventListener('loadeddata', onReady);
        });

        if (!cropCanvas) {
          cropCanvas = document.createElement('canvas');
          cropCtx = cropCanvas.getContext('2d', { alpha: false, desynchronized: true });
        }
        
        // CRITICAL FIX: Pre-size the canvas to target dimensions BEFORE calling captureStream.
        // Otherwise, it initializes at 300x150 and resizes on the first frame, causing a zoom glitch.
        const initialDevRect = recordingCropFrame.getBoundingClientRect();
        cropCanvas.width = Math.round(initialDevRect.width);
        cropCanvas.height = Math.round(initialDevRect.height);
        
        cropCtx.imageSmoothingEnabled = true;
        cropCtx.imageSmoothingQuality = 'medium';

        function drawFallbackFrame(now, metadata) {
           if (!isRecording) return;
           if (helperVideo.videoWidth > 0) {
              const devRect = recordingCropFrame.getBoundingClientRect();
              const scaleX = helperVideo.videoWidth / window.innerWidth;
              const scaleY = helperVideo.videoHeight / window.innerHeight;
              
              if (cropCanvas.width !== Math.round(devRect.width) || cropCanvas.height !== Math.round(devRect.height)) {
                cropCanvas.width = Math.round(devRect.width);
                cropCanvas.height = Math.round(devRect.height);
                cropCtx.fillStyle = '#12151d';
                cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
              }

              cropCtx.drawImage(
                 helperVideo,
                 Math.max(0, Math.round(devRect.left * scaleX)), 
                 Math.max(0, Math.round(devRect.top * scaleY)),
                 Math.round(devRect.width * scaleX), 
                 Math.round(devRect.height * scaleY),
                 0, 0,
                 cropCanvas.width, cropCanvas.height
              );
           }
           helperVideo.requestVideoFrameCallback(drawFallbackFrame);
        }
        
        helperVideo.requestVideoFrameCallback(drawFallbackFrame);
        croppedStream = cropCanvas.captureStream(30);
        rawDisplayStream.getAudioTracks().forEach(track => croppedStream.addTrack(track));
      }

      // Set recording flag
      isRecording = true;
      recordBtn.classList.add('recording');
      recordBtnText.innerText = 'Stop';
      startRecordingTimer();

      // Best WebM Codec Configuration (VP9 / VP8)
      const selectedMime = getSupportedWebmMime();
      recordedChunks = [];

      mediaRecorder = new MediaRecorder(croppedStream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 6000000 // 6 Mbps
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const durationSec = Math.floor((Date.now() - recordStartTime) / 1000);
        const durationMs = Date.now() - recordStartTime;

        let finalBlob = new Blob(recordedChunks, { type: selectedMime });

        if (typeof ysFixWebmDuration !== 'undefined' && durationMs > 500) {
          finalBlob = await new Promise(resolve => {
            ysFixWebmDuration(finalBlob, durationMs, (fixedBlob) => {
              resolve(fixedBlob || finalBlob);
            });
          });
        }

        recordedBlob = finalBlob;
        if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
        currentVideoUrl = URL.createObjectURL(recordedBlob);

        recordedVideoPlayer.src = currentVideoUrl;

        // Configure Download Button
        const timestamp = Date.now();
        const finalMb = (recordedBlob.size / (1024 * 1024)).toFixed(1);
        if (downloadRecordBtn) {
          downloadRecordBtn.href = currentVideoUrl;
          downloadRecordBtn.download = `mobile-recording-${timestamp}.webm`;
        }
        if (downloadBtnLabel) {
          downloadBtnLabel.innerText = `Download Native VP9 WebM (${finalMb} MB)`;
        }

        videoDurationInfo.innerText = `Duration: ${formatTimer(durationSec)}`;
        if (videoFormatBadge) {
          videoFormatBadge.innerText = 'Native Mobile Crop (VP9 WebM)';
        }

        // Open Modal
        recordModalBackdrop.classList.add('active');
        recordedVideoPlayer.play().catch(() => {});
        showToast('🎬 Native VP9 WebM recording ready for download!');
      };

      if (videoTrack) {
        videoTrack.onended = () => {
          if (isRecording) stopScreenRecording();
        };
      }

      mediaRecorder.start(1000);
      showToast('🔴 Recording Started (Zero-Stutter Native VP9 WebM)');

    } catch (err) {
      console.warn('Screen recording cancelled or error:', err);
      isRecording = false;
      activeCropRect = null;
      if (err.name !== 'NotAllowedError') {
        alert('Could not start screen recording: ' + err.message);
      } else {
        showToast('Screen sharing cancelled');
      }
    }
  }

  function stopScreenRecording() {
    if (!isRecording) return;
    isRecording = false;

    recordBtn.classList.remove('recording');
    recordBtnText.innerText = 'Record';
    stopRecordingTimer();

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.requestData(); } catch (e) {}
      mediaRecorder.stop();
    }

    if (rawDisplayStream) {
      rawDisplayStream.getTracks().forEach(track => track.stop());
      rawDisplayStream = null;
    }

    if (croppedStream && croppedStream !== rawDisplayStream) {
      croppedStream.getTracks().forEach(track => track.stop());
      croppedStream = null;
    }

    if (helperVideo) {
      helperVideo.pause();
      helperVideo.srcObject = null;
      if (helperVideo.isConnected) {
        helperVideo.remove();
      }
      helperVideo = null;
    }
  }

  recordBtn.addEventListener('click', () => {
    if (!isRecording) {
      if (cropOverlayContainer && cropOverlayContainer.classList.contains('active')) {
        closeCropViewfinder();
      } else {
        openCropViewfinder();
      }
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

  if (downloadRecordBtn) {
    downloadRecordBtn.addEventListener('click', () => {
      showToast('⬇️ 1080p WebM video download started');
    });
  }

})();
