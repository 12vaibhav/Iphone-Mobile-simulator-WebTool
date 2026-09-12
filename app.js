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
    // Force reflow
    void touchRipple.offsetWidth;
    touchRipple.classList.add('animating');
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
    });

    emptyPlaceholder.addEventListener('mousedown', (e) => {
      if (!isTouchIndicatorEnabled) return;
      circularTouchCursor.classList.add('active');
      const rect = emptyPlaceholder.getBoundingClientRect();
      const scale = getCurrentScale();
      triggerTouchRipple((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale);
    });

    emptyPlaceholder.addEventListener('mouseup', () => {
      circularTouchCursor.classList.remove('active');
    });

    emptyPlaceholder.addEventListener('mouseleave', handleScreenPointerLeave);
  }

  // Hook iframe document for tracking without blocking clicks
  function hookIframeDocument() {
    try {
      const iframeDoc = simulatorIframe.contentDocument || simulatorIframe.contentWindow.document;
      if (!iframeDoc) return;

      // Ensure native hardware SVG cursor and hidden scrollbar inside iframe document
      try {
        const style = iframeDoc.createElement('style');
        style.textContent = `
          * { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'%3E%3Ccircle cx='17' cy='17' r='14' fill='rgba(255,255,255,0.35)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3Ccircle cx='17' cy='17' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 17 17, auto !important; }
          ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
          ::-webkit-scrollbar-track { background: transparent !important; }
          ::-webkit-scrollbar-thumb { background: transparent !important; }
          html, body { -ms-overflow-style: none !important; scrollbar-width: none !important; overflow-x: hidden !important; max-width: 100% !important; }
        `;
        if (iframeDoc.head) iframeDoc.head.appendChild(style);
      } catch (styleErr) {}

      // Intercept in-page anchor clicks (scroll-down buttons) to prevent iframe navigation/reloads
      iframeDoc.addEventListener('click', (e) => {
        const anchor = e.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (href && (href.startsWith('#') || href.startsWith('/#') || href === '')) {
          e.preventDefault();
          const hash = href.includes('#') ? href.substring(href.indexOf('#')) : '';
          if (!hash || hash === '#' || hash === '#top') {
            iframeDoc.defaultView.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            try {
              const targetEl = iframeDoc.querySelector(hash) || iframeDoc.getElementById(hash.substring(1));
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            } catch (err) {
              const idEl = iframeDoc.getElementById(hash.substring(1));
              if (idEl) idEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }
      }, true);

      // Instant 0ms GPU movement inside iframe document
      iframeDoc.addEventListener('mousemove', (e) => {
        if (!isTouchIndicatorEnabled) return;
        setCursorPos(e.clientX, e.clientY);
      });

      iframeDoc.addEventListener('mouseleave', handleScreenPointerLeave);

      // Mousedown: plays visual tap ripple AND clicks the button natively!
      iframeDoc.addEventListener('mousedown', (e) => {
        if (!isTouchIndicatorEnabled) return;
        circularTouchCursor.classList.add('active');
        triggerTouchRipple(e.clientX, e.clientY);
      });

      iframeDoc.addEventListener('mouseup', () => {
        circularTouchCursor.classList.remove('active');
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

      deviceRigContainer.style.transform = `scale(${Math.max(autoScale, 0.35).toFixed(3)})`;
    } else {
      const fixedScale = parseFloat(scaleMode);
      deviceRigContainer.style.transform = `scale(${fixedScale})`;
    }
  }

  scaleSelect.addEventListener('change', calculateAndApplyScale);
  window.addEventListener('resize', calculateAndApplyScale);

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

  // Optimized fallback render loop (only runs if native CropTarget is unavailable)
  function renderCroppedDeviceLoop() {
    if (!isRecording || isNativeCropActive || !helperVideo || !cropCtx) return;

    try {
      if (!cachedDeviceRect) updateCachedRect();
      const rect = cachedDeviceRect;
      const vWidth = helperVideo.videoWidth;
      const vHeight = helperVideo.videoHeight;

      if (vWidth > 0 && vHeight > 0 && rect && rect.width > 0 && rect.height > 0) {
        const scaleX = vWidth / window.innerWidth;
        const scaleY = vHeight / window.innerHeight;

        const sx = Math.max(0, rect.left * scaleX);
        const sy = Math.max(0, rect.top * scaleY);
        const sWidth = Math.min(vWidth - sx, rect.width * scaleX);
        const sHeight = Math.min(vHeight - sy, rect.height * scaleY);

        if (sWidth > 10 && sHeight > 10) {
          const isLandscapeMode = deviceWrapper.classList.contains('landscape');
          const targetW = isLandscapeMode ? 1920 : 880;
          const targetH = isLandscapeMode ? 880 : 1920;

          if (cropCanvas.width !== targetW || cropCanvas.height !== targetH) {
            cropCanvas.width = targetW;
            cropCanvas.height = targetH;
          }

          cropCtx.drawImage(helperVideo, sx, sy, sWidth, sHeight, 0, 0, targetW, targetH);
        }
      }
    } catch (err) {
      console.warn('Fallback crop render notice:', err);
    }

    cropAnimFrameId = requestAnimationFrame(renderCroppedDeviceLoop);
  }

  async function startScreenRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Screen Recording API is not supported in this browser. Please use Chrome, Edge, or Firefox.');
      return;
    }

    try {
      updateCachedRect();

      // Request screen stream with tab audio
      rawDisplayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 60, max: 60 }
        },
        audio: true,
        preferCurrentTab: true
      });

      isNativeCropActive = false;
      let finalStreamToRecord = rawDisplayStream;

      // 1. Try Native Hardware Region Capture (CropTarget API - 0% CPU overhead, 100% smooth scrolling)
      if (window.CropTarget && typeof CropTarget.fromElement === 'function') {
        try {
          const cropTarget = await CropTarget.fromElement(deviceWrapper);
          const [videoTrack] = rawDisplayStream.getVideoTracks();
          if (videoTrack && typeof videoTrack.cropTo === 'function') {
            await videoTrack.cropTo(cropTarget);
            isNativeCropActive = true;
            finalStreamToRecord = rawDisplayStream;
          }
        } catch (cropErr) {
          console.log('Region capture fallback to optimized canvas:', cropErr);
        }
      }

      // 2. Optimized Canvas Fallback if native CropTarget is unsupported
      if (!isNativeCropActive) {
        if (!helperVideo) {
          helperVideo = document.createElement('video');
          helperVideo.muted = true;
          helperVideo.playsInline = true;
          helperVideo.setAttribute('playsinline', '');
        }
        helperVideo.srcObject = rawDisplayStream;
        await helperVideo.play();

        if (!cropCanvas) {
          cropCanvas = document.createElement('canvas');
          cropCtx = cropCanvas.getContext('2d', { alpha: false, desynchronized: true });
        }

        const isLandscapeMode = deviceWrapper.classList.contains('landscape');
        cropCanvas.width = isLandscapeMode ? 1920 : 880;
        cropCanvas.height = isLandscapeMode ? 880 : 1920;

        renderCroppedDeviceLoop();

        croppedStream = cropCanvas.captureStream(60);
        rawDisplayStream.getAudioTracks().forEach(track => croppedStream.addTrack(track));
        finalStreamToRecord = croppedStream;
      }

      // MIME Type Selection
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
      ];
      let selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(finalStreamToRecord, {
        mimeType: selectedMime,
        videoBitsPerSecond: 8000000 // 8Mbps high clarity with smooth performance
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const durationSec = Math.floor((Date.now() - recordStartTime) / 1000);
        const finalBlob = new Blob(recordedChunks, { type: selectedMime });

        if (currentVideoUrl) {
          URL.revokeObjectURL(currentVideoUrl);
        }
        currentVideoUrl = URL.createObjectURL(finalBlob);

        // Populate Modal
        recordedVideoPlayer.src = currentVideoUrl;
        downloadRecordBtn.href = currentVideoUrl;
        downloadRecordBtn.download = `mobile-recording-${Date.now()}.webm`;
        videoDurationInfo.innerText = `Duration: ${formatTimer(durationSec)}`;

        // Open Modal
        recordModalBackdrop.classList.add('active');
        recordedVideoPlayer.play().catch(() => {});
        showToast('🎬 Recording complete!');
      };

      // Handle user ending sharing from browser system bar
      const videoTrack = rawDisplayStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (isRecording) stopScreenRecording();
        };
      }

      mediaRecorder.start(1000);
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
