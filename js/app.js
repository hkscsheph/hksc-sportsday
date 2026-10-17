import { createDemoRecording } from "./demo.js";
import { FrameStore, PhotoView } from "./store.js";
import {
  clamp,
  droppedFrames,
  formatRaceTime,
  gapAt,
  photoToScreenX,
  screenToPhotoX,
  timeAtX,
  xAtTime,
} from "./timing.js";

const SETTINGS_KEY = "hksc-photo-finish";
const EVENT_PICKS = {
  gender: ["男子", "女子"],
  division: ["高中", "初中", "甲組", "乙組", "丙組"],
  distance: ["100米", "200米", "400米", "800米"],
};
const UI_FONT = '"Noto Sans TC", Barlow, sans-serif';
const DISPLAY_FONT = '"Noto Sans TC", "Barlow Condensed", sans-serif';
const COLORS = ["#ffb000", "#3ee0a2", "#4cc9f0", "#ff6b6b", "#c77dff", "#f4f1de", "#ff8c42", "#80ed99"];

const $ = (id) => document.getElementById(id);

const els = {
  toast: $("toast"),
  home: $("screen-home"),
  camera: $("screen-camera"),
  review: $("screen-review"),
  fileBanner: $("file-banner"),
  eventName: $("event-name"),
  eventPick: $("event-pick"),
  eventOptions: $("event-options"),
  handsFree: $("hands-free"),
  bufferHint: $("buffer-hint"),
  openCamera: $("open-camera"),
  practice: $("practice"),
  openHelp: $("open-help"),
  help: $("help"),
  helpClose: $("help-close"),
  cameraFeed: $("camera-feed"),
  cameraWaiting: $("camera-waiting"),
  preview: $("preview"),
  video: $("video"),
  closeCamera: $("close-camera"),
  cameraStatus: $("camera-status"),
  cameraEvent: $("camera-event"),
  countdown: $("countdown"),
  countdownNum: $("countdown-num"),
  cameraError: $("camera-error"),
  cameraErrorText: $("camera-error-text"),
  cameraRetry: $("camera-retry"),
  cameraPractice: $("camera-practice"),
  clock: $("clock"),
  clockSr: $("clock-sr"),
  holdLabel: $("hold-label"),
  buffer: $("buffer"),
  bufferFill: $("buffer-fill"),
  bufferLabel: $("buffer-label"),
  liveStrip: $("live-strip"),
  meterWrap: $("meter-wrap"),
  meterFill: $("meter-fill"),
  sensitivityWrap: $("sensitivity-wrap"),
  sensitivity: $("sensitivity"),
  sensitivityValue: $("sensitivity-value"),
  line: $("line"),
  lineValue: $("line-value"),
  camZoom: $("cam-zoom"),
  zoomValue: $("zoom-value"),
  cameraHint: $("camera-hint"),
  primary: $("primary"),
  secondary: $("secondary"),
  discard: $("discard"),
  takeSnapshot: $("take-snapshot"),
  snapshotThumb: $("snapshot-thumb"),
  saveLiveSnapshot: $("save-live-snapshot"),
  snapshotPanel: $("snapshot-panel"),
  snapshotImg: $("snapshot-img"),
  snapshotCaption: $("snapshot-caption"),
  reviewTitle: $("review-title"),
  demoBanner: $("demo-banner"),
  heroTime: $("hero-time"),
  heroCaption: $("hero-caption"),
  stage: $("stage"),
  ruler: $("ruler"),
  photoWrap: $("photo-wrap"),
  photo: $("photo"),
  marksLayer: $("marks-layer"),
  nudgeCaption: $("nudge-caption"),
  markBtn: $("mark-btn"),
  slice: $("slice"),
  sliceValue: $("slice-value"),
  timeZoom: $("time-zoom"),
  timeZoomValue: $("time-zoom-value"),
  magnify: $("magnify"),
  magnifyValue: $("magnify-value"),
  slit: $("slit"),
  slitValue: $("slit-value"),
  mirror: $("mirror"),
  delay: $("delay"),
  delayValue: $("delay-value"),
  accuracyNote: $("accuracy-note"),
  savePhoto: $("save-photo"),
  saveSnapshot: $("save-snapshot"),
  saveCsv: $("save-csv"),
  shareBtn: $("share-btn"),
  resultCount: $("result-count"),
  resultsEmpty: $("results-empty"),
  results: $("results"),
  clearMarks: $("clear-marks"),
  newRace: $("new-race"),
};

const state = {
  screen: "home",
  settings: loadSettings(),
  stream: null,
  facing: "environment",
  slitNorm: 0.5,
  panYNorm: 0.5,
  camZoom: 1,
  fps: 0,
  frameGen: 0,
  clockStart: null,
  capturing: false,
  listening: false,
  listenSince: 0,
  prevPeak: 0,
  store: null,
  lock: null,
  countdownTimer: 0,
  countdownDeadline: 0,
  audioCtx: null,
  analyser: null,
  audioStream: null,
  wakeLock: null,
  view: null,
  hairlineTime: 0,
  timeZoom: 1,
  magnify: 1,
  marks: [],
  selectedId: null,
  markSeq: 0,
  demo: false,
  inertia: 0,
  drawQueued: false,
  lastSrSecond: -1,
  liveStamp: 0,
  snapshots: [],
  snapshotGen: 0,
  snapshotPending: false,
  lastSnapshotAt: 0,
};

let previewCtx;
let photoCtx;
let rulerCtx;
let resizeObserver;

function loadSettings() {
  const defaults = {
    eventName: "",
    startMode: "tap",
    handsFree: false,
    handsFreeRev: 2,
    bufferMode: "sharp",
    sliceWidth: 7,
    mirror: false,
    lateBy: 0,
    seenHelp: false,
  };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    if (saved.eventName === "Race 1" || saved.eventName === "比賽 1") saved.eventName = "";
    if (saved.handsFreeRev !== 2) {
      saved.handsFree = false;
      saved.handsFreeRev = 2;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function show(screen) {
  state.screen = screen;
  els.home.hidden = screen !== "home";
  els.camera.hidden = screen !== "camera";
  els.review.hidden = screen !== "review";
  if (screen === "review") requestAnimationFrame(renderReview);
}

function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function bandForMode() {
  return state.settings.bufferMode === "long" ? 9 : 21;
}

function applyHomeSettings() {
  els.eventName.value = state.settings.eventName;
  syncEventPicks();
  els.handsFree.checked = state.settings.handsFree;
  document.querySelectorAll("[data-start]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.start === state.settings.startMode));
  });
  document.querySelectorAll("[data-buffer]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.buffer === state.settings.bufferMode));
  });
  els.bufferHint.textContent =
    state.settings.bufferMode === "long"
      ? "較長模式使用較窄的縫，終點錄影可以持續更久。"
      : "清晰模式使用較寬的縫，錄影時間較短。";
  els.fileBanner.hidden = location.protocol !== "file:";
}

function eventPicksFromName(name) {
  const picks = {};
  for (const [group, values] of Object.entries(EVENT_PICKS)) {
    picks[group] = values.find((value) => name.includes(value)) || "";
  }
  return picks;
}

function syncEventPicks() {
  const picks = eventPicksFromName(els.eventName.value);
  document.querySelectorAll("[data-event-value]").forEach((button) => {
    button.setAttribute("aria-pressed", String(picks[button.dataset.eventGroup] === button.dataset.eventValue));
  });
  const label = ["gender", "division", "distance"]
    .map((group) => picks[group])
    .filter(Boolean)
    .map((value) => value.replace(/米|組/g, ""))
    .join("·");
  els.eventPick.textContent = label || "分類";
}

function setEventPick(group, value) {
  const current = eventPicksFromName(els.eventName.value);
  const next = current[group] === value ? "" : value;
  let name = els.eventName.value;
  for (const token of Object.values(EVENT_PICKS).flat()) {
    name = name.replaceAll(token, " ");
  }
  name = name.replace(/\s+/g, " ").trim();
  const tags = ["gender", "division", "distance"]
    .map((key) => (key === group ? next : current[key]))
    .filter(Boolean);
  els.eventName.value = [name, ...tags].filter(Boolean).join(" ").slice(0, 80);
  state.settings.eventName = els.eventName.value;
  syncEventPicks();
  saveSettings();
}

function openHelp() {
  els.help.showModal();
  return new Promise((resolve) => {
    const close = () => {
      els.help.close();
      els.helpClose.removeEventListener("click", close);
      els.help.removeEventListener("close", close);
      resolve();
    };
    els.helpClose.addEventListener("click", close);
    els.help.addEventListener("close", close);
  });
}

function framing() {
  const video = els.video;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const cropW = vw / state.camZoom;
  const cropH = vh / state.camZoom;
  const slitX = clamp(state.slitNorm, 0.02, 0.98) * vw;
  let x = slitX - cropW / 2;
  x = clamp(x, 0, Math.max(0, vw - cropW));
  let y = state.panYNorm * vh - cropH / 2;
  y = clamp(y, 0, Math.max(0, vh - cropH));
  return { x, y, w: cropW, h: cropH, slitX, vw, vh };
}

function activeFraming() {
  return state.lock || framing();
}

async function openCamera() {
  if (location.protocol === "file:") {
    toast("請使用本機伺服器，瀏覽器才能開啟相機。");
    return;
  }
  if (!state.settings.seenHelp) {
    state.settings.seenHelp = true;
    saveSettings();
    await openHelp();
  }
  show("camera");
  hideCameraError();
  els.cameraEvent.textContent = state.settings.eventName || "比賽";
  await startStream();
}

async function startStream() {
  releaseStream();
  hideCameraError();
  els.camera.classList.remove("stream-live");
  els.cameraWaiting.hidden = false;
  els.cameraStatus.textContent = "正在啟動相機…";
  const videoConstraints = {
    facingMode: { ideal: state.facing },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 },
  };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  } catch (error) {
    if (state.facing === "environment") {
      state.facing = "user";
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (inner) {
        showCameraError(inner);
        return;
      }
    } else {
      showCameraError(error);
      return;
    }
  }
  if (state.screen !== "camera") {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    return;
  }
  els.video.srcObject = state.stream;
  els.video.addEventListener("loadeddata", markFeedLive);
  els.video.addEventListener("resize", markFeedLive);
  try {
    await els.video.play();
  } catch (error) {
    showCameraError(error);
    return;
  }
  els.takeSnapshot.hidden = false;
  markFeedLive();
  if (state.screen !== "camera") {
    releaseStream();
    return;
  }
  state.slitNorm = 0.5;
  state.panYNorm = 0.5;
  els.line.value = "50";
  state.frameGen += 1;
  const gen = state.frameGen;
  startCameraLoop();
  if (els.video.requestVideoFrameCallback) {
    const onFrame = (now) => {
      if (gen !== state.frameGen) return;
      noteFps(now);
      captureFrame(now);
      els.video.requestVideoFrameCallback(onFrame);
    };
    els.video.requestVideoFrameCallback(onFrame);
  }
  syncCameraControls();
}

let cameraLoopGen = 0;

function startCameraLoop() {
  const gen = ++cameraLoopGen;
  const loop = (now) => {
    if (gen !== cameraLoopGen || state.screen !== "camera") return;
    if (!els.video.requestVideoFrameCallback && els.video.videoWidth) {
      noteFps(now);
      captureFrame(now);
    }
    if (state.stream?.active && els.video.videoWidth) hideCameraError();
    drawPreview();
    maybeCaptureSnapshot(now);
    updateClock(now);
    updateAudio();
    updateBufferUi();
    if (now - state.liveStamp > 180) {
      state.liveStamp = now;
      try {
        drawLiveStrip();
      } catch {
        /* A bad frame should not stop the clock. */
      }
    }
    updateCountdown(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function hideCameraError() {
  els.cameraError.hidden = true;
  els.cameraError.setAttribute("hidden", "");
  els.cameraError.classList.remove("is-visible");
}

function showCameraError(error) {
  if (state.stream?.active) {
    hideCameraError();
    return;
  }
  const name = error?.name || "";
  let message = "無法啟動相機。你仍可試試練習終點。";
  if (location.protocol === "file:") {
    message = "請從本機伺服器開啟此應用程式。瀏覽器會封鎖 file:// 頁面的相機。";
  } else if (name === "NotAllowedError") {
    message = "相機權限被拒絕。請在瀏覽器設定中允許相機，然後再試一次。";
  } else if (name === "NotFoundError") {
    message = "這台裝置找不到相機。";
  } else if (name === "NotReadableError") {
    message = "相機正被其他應用程式使用。";
  }
  els.camera.classList.remove("stream-live");
  els.cameraWaiting.hidden = true;
  els.cameraErrorText.textContent = message;
  els.cameraError.hidden = false;
  els.cameraError.removeAttribute("hidden");
  els.cameraError.classList.add("is-visible");
  els.cameraStatus.textContent = "無法使用相機";
  els.takeSnapshot.hidden = true;
}

function releaseStream() {
  state.frameGen += 1;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.video.removeEventListener("loadeddata", markFeedLive);
  els.video.removeEventListener("resize", markFeedLive);
  els.video.srcObject = null;
  els.video.style.width = "";
  els.video.style.height = "";
  els.video.style.left = "";
  els.video.style.top = "";
  els.camera.classList.remove("stream-live");
  els.cameraWaiting.hidden = false;
}

function markFeedLive() {
  if (state.screen !== "camera" || !state.stream || !els.video.videoWidth) return;
  els.camera.classList.add("stream-live");
  els.cameraWaiting.hidden = true;
  hideCameraError();
  drawPreview();
  updateBufferUi();
}

function noteFps(now) {
  if (noteFps.last) {
    const dt = now - noteFps.last;
    if (dt > 5 && dt < 200) {
      const instant = 1000 / dt;
      state.fps = state.fps ? state.fps * 0.9 + instant * 0.1 : instant;
    }
  }
  noteFps.last = now;
}

function resizePreview() {
  const rect = (els.cameraFeed || els.preview).getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(rect.width * dpr));
  const height = Math.max(2, Math.round(rect.height * dpr));
  if (els.preview.width !== width || els.preview.height !== height) {
    els.preview.width = width;
    els.preview.height = height;
  }
  return rect;
}

function syncVideoView() {
  const video = els.video;
  if (!video.videoWidth) return;
  const fr = activeFraming();
  const feed = els.cameraFeed.getBoundingClientRect();
  if (feed.width < 2 || feed.height < 2) return;
  const scale = Math.max(feed.width / fr.w, feed.height / fr.h);
  video.style.width = `${video.videoWidth * scale}px`;
  video.style.height = `${video.videoHeight * scale}px`;
  video.style.left = `${(feed.width - fr.w * scale) / 2 - fr.x * scale}px`;
  video.style.top = `${(feed.height - fr.h * scale) / 2 - fr.y * scale}px`;
}

function drawPreview() {
  const video = els.video;
  if (!video.videoWidth) return;
  const feed = resizePreview();
  syncVideoView();
  const ctx = previewCtx;
  const fr = activeFraming();
  const canvas = els.preview;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const slitPx = ((fr.slitX - fr.x) / fr.w) * canvas.width;
  const slicePx = (Math.min(state.settings.sliceWidth, bandForMode()) / fr.w) * canvas.width;
  const shadeLeft = slitPx - slicePx / 2;
  const shadeRight = slitPx + slicePx / 2;
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0, 0, Math.max(0, shadeLeft), canvas.height);
  ctx.fillRect(shadeRight, 0, Math.max(0, canvas.width - shadeRight), canvas.height);
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(slitPx, 0);
  ctx.lineTo(slitPx, canvas.height);
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffb000";
  ctx.beginPath();
  ctx.moveTo(slitPx, 18);
  ctx.lineTo(slitPx + 7, 28);
  ctx.lineTo(slitPx, 38);
  ctx.lineTo(slitPx - 7, 28);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.fillText("終點", slitPx + 12, 34);
}

function updateClock(now) {
  if (state.clockStart == null) {
    els.clock.textContent = "0.00";
    return;
  }
  const elapsed = Math.max(0, (now - state.clockStart) / 1000);
  els.clock.textContent = formatRaceTime(elapsed, 2);
  const second = Math.floor(elapsed);
  if (second !== state.lastSrSecond) {
    state.lastSrSecond = second;
    els.clockSr.textContent = formatRaceTime(elapsed, 1);
  }
}

function captureFrame(now) {
  if (!state.capturing || !state.store || !state.lock || state.clockStart == null) return;
  const time = (now - state.clockStart) / 1000;
  if (time < 0) return;
  const fr = state.lock;
  const store = state.store;
  const srcX = Math.round(fr.slitX - (store.band - 1) / 2);
  const safeX = clamp(srcX, 0, Math.max(0, fr.vw - store.band));
  const scratch = captureScratch(store.band, store.height);
  scratch.ctx.drawImage(els.video, safeX, fr.y, store.band, fr.h, 0, 0, store.band, store.height);
  const rolling = store.push(scratch.ctx.getImageData(0, 0, store.band, store.height).data, time);
  if (rolling && store.dropped === 1) {
    toast("記憶體已滿。只保留終點最新的一段——最後一位選手通過後請停止。");
  }
}

function revokeSnapshots() {
  state.snapshotGen += 1;
  state.snapshotPending = false;
  for (const shot of state.snapshots) URL.revokeObjectURL(shot.url);
  state.snapshots = [];
  els.snapshotThumb.hidden = true;
  els.snapshotThumb.removeAttribute("src");
  els.saveLiveSnapshot.hidden = true;
}

function snapshotAt(time) {
  const list = state.snapshots;
  if (!list.length) return null;
  let best = list[0];
  let bestDist = Math.abs(best.time - time);
  for (let i = 1; i < list.length; i++) {
    const dist = Math.abs(list[i].time - time);
    if (dist < bestDist) {
      best = list[i];
      bestDist = dist;
    }
  }
  return best;
}

function pushSnapshot(blob, time, gen) {
  if (gen !== state.snapshotGen || !blob) return;
  const url = URL.createObjectURL(blob);
  state.snapshots.push({ time, url, blob });
  while (state.snapshots.length > 80) {
    const old = state.snapshots.shift();
    URL.revokeObjectURL(old.url);
  }
  if (state.screen === "camera") {
    els.snapshotThumb.hidden = false;
    els.snapshotThumb.src = url;
    els.saveLiveSnapshot.hidden = false;
  }
  if (state.screen === "review") renderSnapshot();
}

function videoFrameBlob(video) {
  const maxW = 1600;
  const scale = Math.min(1, maxW / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

async function captureStillBlob() {
  const video = els.video;
  if (!video.videoWidth) return null;
  const track = state.stream?.getVideoTracks?.()[0];
  if (track && typeof ImageCapture !== "undefined") {
    try {
      const blob = await Promise.race([
        new ImageCapture(track).takePhoto(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500)),
      ]);
      if (blob?.size) return blob;
    } catch {
      /* The live video frame is still a real webcam picture. */
    }
  }
  return videoFrameBlob(video);
}

function maybeCaptureSnapshot(now) {
  if (!state.capturing || state.snapshotPending || !els.video.videoWidth) return;
  if (now - state.lastSnapshotAt < 450) return;
  state.lastSnapshotAt = now;
  const time = state.clockStart == null ? 0 : Math.max(0, (now - state.clockStart) / 1000);
  const gen = state.snapshotGen;
  state.snapshotPending = true;
  videoFrameBlob(els.video).then((blob) => {
    state.snapshotPending = false;
    pushSnapshot(blob, time, gen);
  });
}

async function takeSnapshot() {
  if (!els.video.videoWidth) {
    toast("請等待相機畫面。");
    return;
  }
  const time = state.clockStart == null ? 0 : Math.max(0, (performance.now() - state.clockStart) / 1000);
  const gen = state.snapshotGen;
  els.takeSnapshot.disabled = true;
  try {
    const blob = await captureStillBlob();
    if (!blob) throw new Error("無法從相機取得快照");
    pushSnapshot(blob, time, gen);
    toast("已拍攝相機快照");
  } catch (error) {
    toast(error.message || "無法從相機取得快照");
  } finally {
    els.takeSnapshot.disabled = false;
  }
}

function saveSnapshotFile(shot) {
  if (!shot?.blob) {
    toast("尚無相機快照");
    return;
  }
  const type = shot.blob.type || "image/jpeg";
  const ext = type.includes("png") ? "png" : "jpg";
  downloadBlob(shot.blob, `${fileSlug()}-snapshot.${ext}`);
  toast("快照已儲存");
}

function renderSnapshot() {
  const shot = state.demo ? null : snapshotAt(state.hairlineTime);
  els.snapshotPanel.hidden = !shot;
  els.saveSnapshot.hidden = !shot;
  if (!shot) return;
  if (els.snapshotImg.dataset.url !== shot.url) {
    els.snapshotImg.dataset.url = shot.url;
    els.snapshotImg.src = shot.url;
  }
  els.snapshotCaption.textContent = `相機快照 · ${formatRaceTime(shot.time)}`;
}

function captureScratch(band, height) {
  if (!captureScratch.canvas || captureScratch.band !== band || captureScratch.height !== height) {
    const canvas = document.createElement("canvas");
    canvas.width = band;
    canvas.height = height;
    captureScratch.canvas = canvas;
    captureScratch.ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
    captureScratch.band = band;
    captureScratch.height = height;
  }
  return captureScratch;
}

function estimateHoldSeconds() {
  if (!els.video.videoWidth || state.fps < 1) return null;
  const fr = framing();
  const band = bandForMode();
  const capH = state.settings.bufferMode === "long" ? 720 : 1080;
  const height = Math.max(2, Math.min(capH, Math.round(fr.h)));
  const frames = Math.max(90, Math.min(4000, Math.floor((72 * 1024 * 1024) / (band * height * 4))));
  return frames / state.fps;
}

function updateBufferUi() {
  const hold = estimateHoldSeconds();
  const settings = state.stream?.getVideoTracks?.()[0]?.getSettings?.() || {};
  const fpsText = state.fps ? `${Math.round(state.fps)} fps` : "正在測量幀率";
  const sizeText = settings.width ? `${settings.width}×${settings.height}` : "";
  els.cameraStatus.textContent = [sizeText, fpsText].filter(Boolean).join(" · ") || "相機就緒";
  if (state.clockStart == null) {
    els.holdLabel.textContent = hold ? `約可保留 ${Math.round(hold)} 秒` : "";
  }
  const store = state.store;
  const showBuffer = Boolean(store && (state.capturing || store.count));
  els.buffer.hidden = !showBuffer;
  els.liveStrip.hidden = !showBuffer;
  if (!store || !showBuffer) return;
  const ratio = store.count / store.max;
  els.bufferFill.style.width = `${Math.min(100, ratio * 100)}%`;
  els.buffer.classList.toggle("rolling", store.dropped > 0);
  const from = formatRaceTime(store.oldestTime(), 1);
  const to = formatRaceTime(store.newestTime(), 1);
  els.bufferLabel.textContent = store.dropped
    ? `僅保留最新 · ${from}–${to}`
    : `${from}–${to}`;
  els.holdLabel.textContent = store.dropped ? "緩衝區滾動中" : `${store.count} 幀`;
}

function drawLiveStrip() {
  const store = state.store;
  if (!store?.count) return;
  const canvas = els.liveStrip;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(2, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  const frames = Math.min(store.count, Math.max(8, Math.floor(width / 4)));
  const dw = width / frames;
  const scratch = captureScratch(store.band, store.height);
  ctx.fillStyle = "#10141b";
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < frames; i++) {
    const index = store.count - frames + i;
    const off = store.frameOffset(index);
    scratch.ctx.putImageData(new ImageData(store.bytes.slice(off, off + store.frameBytes), store.band, store.height), 0, 0);
    const srcX = Math.floor((store.band - 1) / 2);
    ctx.drawImage(scratch.canvas, srcX, 0, 1, store.height, i * dw, 0, dw + 0.5, height);
  }
}

function syncCameraControls() {
  const countdown = Boolean(state.countdownTimer);
  const clockOn = state.clockStart != null && !countdown;
  els.discard.hidden = !clockOn && !state.listening;
  els.sensitivityWrap.hidden = !state.listening;
  els.meterWrap.hidden = !state.listening;
  els.camera.classList.toggle("recording", state.capturing);
  const locked = Boolean(state.lock);
  els.line.disabled = locked;
  els.camZoom.disabled = locked;
  if (countdown) {
    els.primary.textContent = "取消倒數";
    els.secondary.hidden = true;
    els.cameraHint.textContent = "提示音響起時計時開始。";
    return;
  }
  if (state.listening && state.clockStart == null) {
    els.primary.textContent = "取消聆聽";
    els.secondary.hidden = true;
    els.cameraHint.textContent = "音量表跳動時拍手或鳴槍起跑。";
    return;
  }
  if (!clockOn) {
    const labels = { tap: "開始計時", sound: "準備起跑", countdown: "開始倒數" };
    els.primary.textContent = labels[state.settings.startMode];
    els.secondary.hidden = true;
    els.cameraHint.textContent = state.settings.handsFree
      ? "計時開始就會錄影。把手機架好，讓白線保持在終點上。"
      : "鳴槍時開始計時，選手到達終點線時再按錄影。";
    return;
  }
  if (!state.store && !state.capturing) {
    els.primary.textContent = "錄下終點";
    els.secondary.hidden = true;
    els.cameraHint.textContent = "計時進行中。在他們通過終點的前後錄影。";
    return;
  }
  els.primary.textContent = "停止並合成照片";
  els.secondary.hidden = false;
  els.secondary.textContent = state.capturing ? "暫停" : "繼續";
  els.cameraHint.textContent = state.capturing
    ? "保持穩定。最後一位選手通過後立刻停止。"
    : "錄影已暫停。計時仍在進行。";
}

function beginStart() {
  if (state.settings.startMode === "sound") armSound();
  else if (state.settings.startMode === "countdown") startCountdown();
  else startClock(performance.now());
}

function startClock(perfTime) {
  state.clockStart = perfTime;
  state.listening = false;
  stopAudioInput();
  if (state.settings.handsFree) startCapture();
  stayAwake();
  syncCameraControls();
}

function startCapture() {
  if (!els.video.videoWidth) {
    toast("請等待相機畫面。");
    return;
  }
  if (!state.store) {
    state.lock = framing();
    const band = bandForMode();
    const capH = state.settings.bufferMode === "long" ? 720 : 1080;
    const height = Math.max(2, Math.min(capH, Math.round(state.lock.h)));
    let frames = Math.floor((72 * 1024 * 1024) / (band * height * 4));
    frames = clamp(frames, 90, 4000);
    try {
      state.store = new FrameStore(band, height, frames);
    } catch {
      state.store = new FrameStore(band, Math.min(height, 480), 300);
    }
  }
  state.capturing = true;
  syncCameraControls();
}

function togglePause() {
  if (!state.store) return;
  state.capturing = !state.capturing;
  syncCameraControls();
}

async function stayAwake() {
  try {
    state.wakeLock = await navigator.wakeLock?.request("screen");
  } catch {
    state.wakeLock = null;
  }
}

function releaseWakeLock() {
  state.wakeLock?.release?.();
  state.wakeLock = null;
}

async function armSound() {
  try {
    state.audioCtx = state.audioCtx || new AudioContext();
    await state.audioCtx.resume();
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const source = state.audioCtx.createMediaStreamSource(state.audioStream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 1024;
    source.connect(state.analyser);
    state.listening = true;
    state.listenSince = performance.now();
    state.prevPeak = 0;
    syncCameraControls();
  } catch {
    toast("需要麥克風權限，才能以聲音起跑。");
  }
}

function updateAudio() {
  if (!state.listening || !state.analyser || state.clockStart != null) return;
  const buffer = updateAudio.buffer || (updateAudio.buffer = new Float32Array(state.analyser.fftSize));
  state.analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample));
  els.meterFill.style.width = `${Math.min(100, peak * 140)}%`;
  const threshold = Number(els.sensitivity.value);
  if (performance.now() - state.listenSince < 400) {
    state.prevPeak = peak;
    return;
  }
  if (peak >= threshold && state.prevPeak < threshold * 0.65) {
    const latency = (state.analyser.fftSize / state.audioCtx.sampleRate) * 1000;
    startClock(performance.now() - latency);
    toast("已偵測到起跑");
  }
  state.prevPeak = peak;
}

async function startCountdown() {
  state.audioCtx = state.audioCtx || new AudioContext();
  await state.audioCtx.resume();
  const startAt = state.audioCtx.currentTime + 3;
  const perfAtGo = performance.now() + (startAt - state.audioCtx.currentTime) * 1000;
  beep(660, 0.12, startAt - 3);
  beep(660, 0.12, startAt - 2);
  beep(660, 0.12, startAt - 1);
  beep(990, 0.28, startAt);
  state.countdownDeadline = perfAtGo;
  els.countdown.hidden = false;
  state.countdownTimer = window.setTimeout(() => {
    state.countdownTimer = 0;
    els.countdown.hidden = true;
    startClock(perfAtGo);
  }, Math.max(0, perfAtGo - performance.now()));
  syncCameraControls();
}

function beep(frequency, duration, when) {
  const ctx = state.audioCtx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t = when ?? ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function updateCountdown(now) {
  if (!state.countdownTimer && els.countdown.hidden) return;
  const left = (state.countdownDeadline - now) / 1000;
  els.countdownNum.textContent = left > 2 ? "3" : left > 1 ? "2" : left > 0 ? "1" : "出發";
}

function cancelCountdown() {
  clearTimeout(state.countdownTimer);
  state.countdownTimer = 0;
  els.countdown.hidden = true;
  syncCameraControls();
}

function stopAudioInput() {
  state.audioStream?.getTracks().forEach((track) => track.stop());
  state.audioStream = null;
  state.analyser = null;
}

function discardRace() {
  if (state.clockStart != null && !confirm("捨棄這場比賽？")) return;
  clearTimeout(state.countdownTimer);
  state.countdownTimer = 0;
  els.countdown.hidden = true;
  state.clockStart = null;
  state.capturing = false;
  state.listening = false;
  state.store = null;
  state.lock = null;
  stopAudioInput();
  releaseWakeLock();
  syncCameraControls();
}

function leaveCamera() {
  if ((state.clockStart != null || state.store?.count) && !confirm("離開這場比賽？錄影將被捨棄。")) {
    return;
  }
  shutdownCamera();
  show("home");
}

function shutdownCamera({ keepSnapshots = false } = {}) {
  cameraLoopGen += 1;
  clearTimeout(state.countdownTimer);
  state.countdownTimer = 0;
  state.clockStart = null;
  state.capturing = false;
  state.listening = false;
  state.store = null;
  state.lock = null;
  stopAudioInput();
  releaseWakeLock();
  releaseStream();
  els.takeSnapshot.hidden = true;
  if (!keepSnapshots) revokeSnapshots();
}

async function stopAndBuild() {
  if (!state.store || state.store.count < 2) {
    toast("請再錄久一點，再合成照片。");
    return;
  }
  state.capturing = false;
  const time = state.clockStart == null ? 0 : Math.max(0, (performance.now() - state.clockStart) / 1000);
  const gen = state.snapshotGen;
  try {
    const blob = await captureStillBlob();
    pushSnapshot(blob, time, gen);
  } catch {
    /* Sampled webcam frames from the recording are still kept. */
  }
  const store = state.store;
  const eventName = state.settings.eventName;
  shutdownCamera({ keepSnapshots: true });
  state.store = store;
  enterReview(store, { demo: false, eventName });
}

function enterReview(store, { demo, eventName }) {
  state.view = new PhotoView(store);
  state.demo = demo;
  state.marks = [];
  state.selectedId = null;
  state.markSeq = 0;
  state.inertia = 0;
  const slice = clamp(state.settings.sliceWidth, 1, store.band);
  state.view.setOptions({ sliceWidth: slice, slitShift: 0 });
  els.slice.max = String(store.band);
  els.slice.value = String(slice);
  els.slit.value = "0";
  syncSlitRange();
  els.mirror.checked = demo ? true : state.settings.mirror;
  els.delay.value = String(state.settings.lateBy);
  els.magnify.value = "1";
  state.magnify = 1;
  state.timeZoom = 1;
  const times = state.view.times;
  state.hairlineTime = times[Math.floor(times.length / 2)] || 0;
  if (demo) revokeSnapshots();
  els.reviewTitle.textContent = eventName || state.settings.eventName || "比賽";
  els.demoBanner.hidden = !demo;
  if (demo) {
    state.settings.lateBy = 0;
    els.delay.value = "0";
    els.demoBanner.textContent =
      "練習終點。號碼布 12、7、21、3 分別在 10.000、10.250、10.500、10.750 對上線。青色邊緣是軀幹。已開啟翻轉，讓號碼方向正確。";
    for (const runner of [
      { name: "12", time: 10 },
      { name: "7", time: 10.25 },
      { name: "21", time: 10.5 },
      { name: "3", time: 10.75 },
    ]) {
      addMarkAt(runner.time, runner.name);
    }
    state.hairlineTime = 10;
    state.selectedId = null;
  }
  renderResults();
  show("review");
  requestAnimationFrame(() => {
    resizeReview();
    state.timeZoom = defaultTimeZoom();
    els.timeZoom.value = state.timeZoom.toFixed(2);
    renderReview();
  });
}

function defaultTimeZoom() {
  const layout = state.view.layout;
  const pxPerSec = 1 / layout.secPerPixel;
  const cssWidth = els.photo.clientWidth || els.photoWrap.clientWidth || window.innerWidth || 360;
  const zoom = cssWidth / (pxPerSec * 6);
  return clamp(zoom, 0.15, 6);
}

function visibleLayoutWidth() {
  const cssWidth = els.photo.clientWidth || 1;
  return cssWidth / state.timeZoom;
}

function viewLeft() {
  const hairX = xAtTime(state.view.layout, state.hairlineTime);
  return hairX - visibleLayoutWidth() / 2;
}

function official(raw) {
  return raw - Number(state.settings.lateBy || 0);
}

function timeBounds() {
  const segs = state.view?.layout.segments || [];
  if (!segs.length) return [0, 0];
  return [segs[0].tFirst, segs[segs.length - 1].tLast];
}

function resizeReview() {
  if (!state.view) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const photoWidth = Math.max(2, Math.round(els.photo.clientWidth * dpr));
  const photoHeight = Math.max(2, Math.round(els.photo.clientHeight * dpr));
  if (els.photo.width !== photoWidth || els.photo.height !== photoHeight) {
    els.photo.width = photoWidth;
    els.photo.height = photoHeight;
  }
  const rulerWidth = photoWidth;
  const rulerHeight = Math.max(2, Math.round(32 * dpr));
  if (els.ruler.width !== rulerWidth || els.ruler.height !== rulerHeight) {
    els.ruler.width = rulerWidth;
    els.ruler.height = rulerHeight;
  }
  const wide = window.innerWidth >= 1000;
  if (!wide) {
    const base = Math.min(window.innerHeight * 0.42, 460);
    els.photoWrap.style.height = `${Math.round(base * state.magnify)}px`;
  } else {
    els.photoWrap.style.height = "100%";
  }
}

function renderReview() {
  if (state.screen !== "review" || !state.view) return;
  resizeReview();
  const layout = state.view.layout;
  const [minT, maxT] = timeBounds();
  const pad = layout.dt * 0.5;
  state.hairlineTime = clamp(state.hairlineTime, minT - pad, maxT + pad);
  const left = viewLeft();
  const vis = visibleLayoutWidth();
  state.view.draw(photoCtx, left, vis, els.mirror.checked);
  drawMarkLines();
  drawRuler(left, vis);
  const gap = gapAt(layout, xAtTime(layout, state.hairlineTime));
  const shown = official(state.hairlineTime);
  els.heroTime.textContent = formatRaceTime(shown);
  els.heroCaption.textContent = gap
    ? `錄影有空檔 · ${formatRaceTime(official(gap.tBefore), 1)} 至 ${formatRaceTime(official(gap.tAfter), 1)}`
    : "軀幹前端對準線上";
  positionMarkLabels(left, vis);
  const fps = 1 / layout.dt;
  const dropped = droppedFrames(state.view.times, layout.dt);
  els.accuracyNote.textContent = `約 ${fps.toFixed(0)} fps，每幀 ${formatRaceTime(layout.dt, 3)} 秒。掉幀 ${dropped}。時間以中線為準。`;
  els.sliceValue.textContent = `${state.view.sliceWidth} px`;
  els.timeZoomValue.textContent = `${state.timeZoom.toFixed(2)}×`;
  els.magnifyValue.textContent = `${state.magnify.toFixed(1)}×`;
  els.slitValue.textContent = `${state.view.slitShift} px`;
  els.delayValue.textContent = `${Number(state.settings.lateBy).toFixed(2)} 秒`;
  els.nudgeCaption.textContent = state.selectedId ? "移動選取的標記" : "移動中線";
  renderSnapshot();
}

function drawMarkLines() {
  const ctx = photoCtx;
  const width = els.photo.width;
  const height = els.photo.height;
  const left = viewLeft();
  const vis = visibleLayoutWidth();
  for (const mark of ranked()) {
    const photoX = xAtTime(state.view.layout, mark.time);
    const screen = photoToScreenX({
      viewLeft: left,
      viewW: vis,
      photoX,
      mirror: els.mirror.checked,
    });
    const deviceX = (screen / vis) * width;
    if (deviceX < -2 || deviceX > width + 2) continue;
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = mark.id === state.selectedId ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(deviceX, 0);
    ctx.lineTo(deviceX, height);
    ctx.stroke();
  }
}

function drawRuler(left, vis) {
  const canvas = els.ruler;
  const ctx = rulerCtx;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0e1218";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const pxPerSec = 1 / state.view.layout.secPerPixel;
  const cssPerSec = (pxPerSec * state.timeZoom);
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30];
  let step = 10;
  for (const candidate of steps) {
    if (candidate * cssPerSec >= 64) {
      step = candidate;
      break;
    }
  }
  const tA = official(timeAtX(state.view.layout, left));
  const tB = official(timeAtX(state.view.layout, left + vis));
  const minT = Math.min(tA, tB);
  const maxT = Math.max(tA, tB);
  const digits = step < 0.1 ? 2 : 1;
  ctx.fillStyle = "#d5dbe6";
  ctx.font = `${Math.round(11 * dpr)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  const first = Math.ceil((minT - 1e-6) / step);
  const last = Math.floor((maxT + 1e-6) / step);
  for (let i = first; i <= last; i++) {
    const tick = i * step;
    const photoX = xAtTime(state.view.layout, tick + Number(state.settings.lateBy));
    const screen = photoToScreenX({
      viewLeft: left,
      viewW: vis,
      photoX,
      mirror: els.mirror.checked,
    });
    const deviceX = (screen / vis) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(deviceX, canvas.height - 7 * dpr);
    ctx.lineTo(deviceX, canvas.height);
    ctx.stroke();
    ctx.fillText(formatRaceTime(tick, digits), deviceX, 4 * dpr);
  }
}

function ranked() {
  return [...state.marks].sort((a, b) => a.time - b.time || a.order - b.order);
}

function renderResults() {
  const list = ranked();
  els.resultCount.textContent = String(list.length);
  els.resultsEmpty.hidden = list.length > 0;
  els.results.innerHTML = "";
  list.forEach((mark, index) => {
    const item = document.createElement("li");
    item.className = "result" + (mark.id === state.selectedId ? " selected" : "");
    item.dataset.id = mark.id;
    const place = document.createElement("span");
    place.className = "place";
    place.style.background = mark.color;
    place.textContent = String(index + 1);
    const input = document.createElement("input");
    input.className = "bib";
    input.value = mark.name;
  input.placeholder = "號碼布／姓名";
  input.autocomplete = "off";
  input.setAttribute("aria-label", `第 ${index + 1} 名的姓名`);
    const time = document.createElement("span");
    time.className = "result-time";
    time.textContent = formatRaceTime(official(mark.time));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn";
    remove.setAttribute("aria-label", `移除第 ${index + 1} 名`);
    remove.textContent = "×";
    item.append(place, input, time, remove);
    els.results.append(item);
  });
}

function labelRow(placed, left, right) {
  for (let row = 0; row < placed.length; row++) {
    const hit = placed[row].some(([start, end]) => left < end + 6 && right > start - 6);
    if (!hit) {
      placed[row].push([left, right]);
      return row;
    }
  }
  placed.push([[left, right]]);
  return placed.length - 1;
}

function positionMarkLabels(left, vis) {
  els.marksLayer.innerHTML = "";
  const width = els.photo.clientWidth;
  const placed = [];
  ranked().forEach((mark, index) => {
    const photoX = xAtTime(state.view.layout, mark.time);
    const screen = photoToScreenX({
      viewLeft: left,
      viewW: vis,
      photoX,
      mirror: els.mirror.checked,
    });
    const cssX = (screen / vis) * width;
    if (cssX < -80 || cssX > width + 80) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mark-label" + (mark.id === state.selectedId ? " selected" : "");
    button.style.left = `${cssX}px`;
    button.textContent = `${index + 1}  ${formatRaceTime(official(mark.time), 2)}`;
    button.dataset.id = mark.id;
    els.marksLayer.append(button);
    const box = button.offsetWidth || 72;
    const row = labelRow(placed, cssX - box / 2, cssX + box / 2);
    button.style.top = `${8 + row * 24}px`;
  });
}

function addMarkAt(time, name = "") {
  const mark = {
    id: uid(),
    time,
    name,
    order: ++state.markSeq,
    color: COLORS[state.marks.length % COLORS.length],
  };
  state.marks.push(mark);
  state.selectedId = mark.id;
  return mark;
}

function addMark() {
  const existing = state.marks.find((mark) => Math.abs(mark.time - state.hairlineTime) < 0.012);
  if (existing) {
    state.selectedId = existing.id;
    toast("這個位置已經標記過");
    renderResults();
    renderReview();
    return;
  }
  addMarkAt(state.hairlineTime);
  navigator.vibrate?.(12);
  toast(`已標記 ${formatRaceTime(official(state.hairlineTime))}`);
  renderResults();
  renderReview();
}

function selectMark(id, follow = true) {
  state.selectedId = id;
  const mark = state.marks.find((item) => item.id === id);
  if (mark && follow) state.hairlineTime = mark.time;
  renderResults();
  renderReview();
}

function removeMark(id) {
  state.marks = state.marks.filter((mark) => mark.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  renderResults();
  renderReview();
}

function nudge(delta) {
  if (state.selectedId) {
    const mark = state.marks.find((item) => item.id === state.selectedId);
    if (!mark) return;
    const [minT, maxT] = timeBounds();
    mark.time = clamp(mark.time + delta, minT, maxT);
    state.hairlineTime = mark.time;
  } else {
    state.hairlineTime += delta;
  }
  state.inertia = 0;
  renderResults();
  renderReview();
}

function syncSlitRange() {
  const maxShift = state.view ? state.view.maxSlitShift() : 8;
  els.slit.min = String(-maxShift);
  els.slit.max = String(maxShift);
  if (Math.abs(Number(els.slit.value)) > maxShift) els.slit.value = "0";
}

function applyViewOptions() {
  if (!state.view) return;
  const previousSlice = state.view.sliceWidth;
  const nextSlice = Number(els.slice.value);
  state.view.setOptions({
    sliceWidth: nextSlice,
    slitShift: Number(els.slit.value),
  });
  if (previousSlice !== state.view.sliceWidth && previousSlice > 0) {
    state.timeZoom = clamp(state.timeZoom * (previousSlice / state.view.sliceWidth), 0.15, 6);
    els.timeZoom.value = state.timeZoom.toFixed(2);
  }
  state.settings.sliceWidth = state.view.sliceWidth;
  saveSettings();
  syncSlitRange();
  renderReview();
}

function resultsText() {
  const lines = [`${els.reviewTitle.textContent}`];
  ranked().forEach((mark, index) => {
    const name = mark.name.trim() || "—";
    lines.push(`${index + 1}. ${formatRaceTime(official(mark.time))}  ${name}`);
  });
  return lines.join("\n");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv() {
  const layout = state.view.layout;
  const lines = [
    `項目,${csvEscape(els.reviewTitle.textContent)}`,
    `已扣除起跑延遲（秒）,${Number(state.settings.lateBy).toFixed(3)}`,
    `幀間隔（秒）,${layout.dt.toFixed(4)}`,
    `每秒幀數,${(1 / layout.dt).toFixed(2)}`,
    "",
    "名次,時間,姓名",
  ];
  ranked().forEach((mark, index) => {
    lines.push(`${index + 1},${official(mark.time).toFixed(3)},${csvEscape(mark.name.trim())}`);
  });
  return `\uFEFF${lines.join("\n")}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileSlug() {
  const name = (els.reviewTitle.textContent || "finish").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${name || "finish"}-${stamp}`;
}

function exportX(rawTime, layout, width) {
  const photoX = xAtTime(layout, rawTime);
  const screen = photoToScreenX({
    viewLeft: 0,
    viewW: layout.totalWidth,
    photoX,
    mirror: els.mirror.checked,
  });
  return (screen / Math.max(1, layout.totalWidth)) * width;
}

function renderExportCanvas(snapshotImage) {
  const view = state.view;
  const layout = view.layout;
  const list = ranked();
  let scale = Math.min(1, 8192 / Math.max(1, layout.totalWidth));
  const rowH = 32;
  const header = 78;
  const rulerH = 36;
  const footer = 40;
  const snapScale = snapshotImage ? snapshotImage.height / snapshotImage.width : 0;
  const snapBlockFor = (w) => {
    if (!snapshotImage) return 0;
    return Math.min(Math.round(w * snapScale), Math.round(w * 0.75)) + 36;
  };
  let photoH = Math.max(1, Math.round(view.store.height * scale));
  let width = Math.max(640, Math.round(layout.totalWidth * scale));
  const tableH = 48 + Math.max(1, list.length) * rowH;
  let snapBlock = snapBlockFor(width);
  let height = header + snapBlock + rulerH + photoH + tableH + footer;
  while (width * height > 14e6 && scale > 0.15) {
    scale *= 0.85;
    photoH = Math.max(1, Math.round(view.store.height * scale));
    width = Math.max(640, Math.round(layout.totalWidth * scale));
    snapBlock = snapBlockFor(width);
    height = header + snapBlock + rulerH + photoH + tableH + footer;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (canvas.width !== width || canvas.height !== height) {
    throw new Error("這張終點照片太大，此裝置無法存成單張圖片。");
  }
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffb000";
  ctx.font = `600 14px ${UI_FONT}`;
  ctx.fillText("HKSC 終點攝影", 20, 28);
  ctx.fillStyle = "#f4f7fb";
  ctx.font = `700 28px ${DISPLAY_FONT}`;
  ctx.fillText(els.reviewTitle.textContent || "比賽", 20, 58);
  ctx.fillStyle = "#9aa3b2";
  ctx.font = `14px ${UI_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleString("zh-Hant"), width - 20, 40);
  ctx.textAlign = "left";

  let cursor = header;
  if (snapshotImage && snapBlock) {
    ctx.fillStyle = "#ffb000";
    ctx.font = `600 14px ${UI_FONT}`;
    ctx.fillText("相機快照", 20, cursor + 22);
    ctx.drawImage(snapshotImage, 0, cursor + 32, width, snapBlock - 36);
    cursor += snapBlock;
  }

  const photoY = cursor + rulerH;
  const photoCanvas = document.createElement("canvas");
  photoCanvas.width = width;
  photoCanvas.height = photoH;
  view.draw(photoCanvas.getContext("2d"), 0, layout.totalWidth, els.mirror.checked);
  ctx.drawImage(photoCanvas, 0, photoY);

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "#d5dbe6";
  ctx.font = `12px ${UI_FONT}`;
  const pxPerSec = (width / Math.max(0.001, timeBounds()[1] - timeBounds()[0]));
  const step = pxPerSec > 180 ? 0.1 : pxPerSec > 70 ? 0.5 : 1;
  const [minRaw, maxRaw] = timeBounds();
  const late = Number(state.settings.lateBy);
  const firstTick = Math.ceil((minRaw - late) / step - 1e-6);
  const lastTick = Math.floor((maxRaw - late) / step + 1e-6);
  for (let i = firstTick; i <= lastTick; i++) {
    const tick = i * step;
    const x = exportX(tick + late, layout, width);
    ctx.beginPath();
    ctx.moveTo(x, cursor + rulerH - 8);
    ctx.lineTo(x, cursor + rulerH);
    ctx.stroke();
    ctx.fillText(formatRaceTime(tick, step < 0.1 ? 2 : 1), x + 4, cursor + 16);
  }

  drawStitchedMarks(ctx, list, layout, width, photoY, photoH);

  let y = photoY + photoH + 28;
  ctx.fillStyle = "#f4f7fb";
  ctx.font = `700 16px ${UI_FONT}`;
  ctx.fillText("成績", 20, y);
  y += 12;
  list.forEach((mark, index) => {
    y += rowH;
    ctx.fillStyle = index % 2 ? "#141922" : "#10141b";
    ctx.fillRect(16, y - 22, width - 32, rowH - 4);
    ctx.fillStyle = mark.color;
    ctx.fillRect(24, y - 16, 8, 20);
    ctx.fillStyle = "#f4f7fb";
    ctx.font = `600 16px ${UI_FONT}`;
    ctx.fillText(String(index + 1), 42, y);
    ctx.font = "700 16px JetBrains Mono, monospace";
    ctx.fillText(formatRaceTime(official(mark.time)), 78, y);
    ctx.font = `16px ${UI_FONT}`;
    ctx.fillText(mark.name.trim() || "—", 210, y);
  });
  ctx.fillStyle = "#9aa3b2";
  ctx.font = `13px ${UI_FONT}`;
  const direction = els.mirror.checked ? "時間由右至左。" : "時間由左至右。";
  ctx.fillText(`時間以軀幹前端為準。${direction}`, 20, height - 16);
  return canvas;
}

function drawStitchedMarks(ctx, list, layout, width, photoY, photoH) {
  const placed = [];
  ctx.font = `700 14px ${UI_FONT}`;
  ctx.textAlign = "left";
  list.forEach((mark, index) => {
    const x = exportX(mark.time, layout, width);
    ctx.strokeStyle = mark.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, photoY);
    ctx.lineTo(x, photoY + photoH);
    ctx.stroke();
    const label = `${index + 1} ${formatRaceTime(official(mark.time), 2)}`;
    const box = ctx.measureText(label).width + 12;
    const left = clamp(x - box / 2, 4, Math.max(4, width - box - 4));
    const row = labelRow(placed, left, left + box);
    const top = photoY + 8 + row * 24;
    ctx.fillStyle = mark.color;
    ctx.fillRect(left, top, box, 20);
    ctx.fillStyle = "#111";
    ctx.fillText(label, left + 6, top + 15);
  });
}

function renderStitchedCanvas() {
  const view = state.view;
  const layout = view.layout;
  const list = ranked();
  let scale = Math.min(1, 8192 / Math.max(1, layout.totalWidth));
  const rulerH = 36;
  let photoH = Math.max(1, Math.round(view.store.height * scale));
  let width = Math.max(640, Math.round(layout.totalWidth * scale));
  while (width * (rulerH + photoH) > 14e6 && scale > 0.15) {
    scale *= 0.85;
    photoH = Math.max(1, Math.round(view.store.height * scale));
    width = Math.max(640, Math.round(layout.totalWidth * scale));
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rulerH + photoH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#090b10";
  ctx.fillRect(0, 0, width, canvas.height);
  const photoCanvas = document.createElement("canvas");
  photoCanvas.width = width;
  photoCanvas.height = photoH;
  view.draw(photoCanvas.getContext("2d"), 0, layout.totalWidth, els.mirror.checked);
  ctx.drawImage(photoCanvas, 0, rulerH);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.fillStyle = "#d5dbe6";
  ctx.font = `12px ${UI_FONT}`;
  const pxPerSec = width / Math.max(0.001, timeBounds()[1] - timeBounds()[0]);
  const step = pxPerSec > 180 ? 0.1 : pxPerSec > 70 ? 0.5 : 1;
  const [minRaw, maxRaw] = timeBounds();
  const late = Number(state.settings.lateBy);
  const firstTick = Math.ceil((minRaw - late) / step - 1e-6);
  const lastTick = Math.floor((maxRaw - late) / step + 1e-6);
  for (let i = firstTick; i <= lastTick; i++) {
    const tick = i * step;
    const x = exportX(tick + late, layout, width);
    ctx.beginPath();
    ctx.moveTo(x, rulerH - 8);
    ctx.lineTo(x, rulerH);
    ctx.stroke();
    ctx.fillText(formatRaceTime(tick, step < 0.1 ? 2 : 1), x + 4, 16);
  }
  drawStitchedMarks(ctx, list, layout, width, rulerH, photoH);
  return canvas;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("無法讀取相機快照"));
    image.src = url;
  });
}

async function photoBlob() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const shot = state.demo ? null : snapshotAt(state.hairlineTime);
  const image = shot ? await loadImage(shot.url) : null;
  const canvas = renderExportCanvas(image);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("瀏覽器無法編碼這張圖片。");
  return blob;
}

async function savePhoto() {
  try {
    els.savePhoto.disabled = true;
    els.savePhoto.textContent = "準備中…";
    const blob = await photoBlob();
    downloadBlob(blob, `${fileSlug()}.png`);
    toast("照片已儲存");
  } catch (error) {
    toast(error.message || "無法儲存照片");
  } finally {
    els.savePhoto.disabled = false;
    els.savePhoto.textContent = "儲存照片";
  }
}

function saveCsv() {
  const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${fileSlug()}.csv`);
  toast("成績已儲存");
}

async function stitchedBlob() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const canvas = renderStitchedCanvas();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("瀏覽器無法編碼這張圖片。");
  return blob;
}

async function shareFinish() {
  try {
    els.shareBtn.disabled = true;
    const blob = await stitchedBlob();
    const file = new File([blob], `${fileSlug()}.png`, { type: "image/png" });
    const payload = { title: els.reviewTitle.textContent, text: resultsText(), files: [file] };
    if (navigator.canShare?.(payload)) {
      await navigator.share(payload);
      return;
    }
    downloadBlob(blob, file.name);
    toast("這裡無法分享，已改為儲存照片。");
  } catch (error) {
    if (error?.name !== "AbortError") toast(error.message || "無法分享照片");
  } finally {
    els.shareBtn.disabled = false;
  }
}

function bindReviewGestures() {
  const pointers = new Map();
  let drag = null;

  const stopInertia = () => {
    state.inertia = 0;
  };

  els.stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".mark-label")) return;
    els.stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stopInertia();
    if (pointers.size === 1) {
      drag = {
        startX: event.clientX,
        startHairX: xAtTime(state.view.layout, state.hairlineTime),
        lastX: event.clientX,
        lastTime: performance.now(),
        zoom: state.timeZoom,
        dist: 0,
        moved: false,
      };
    } else if (pointers.size === 2 && drag) {
      const [a, b] = [...pointers.values()];
      drag.dist = Math.hypot(a.x - b.x, a.y - b.y);
      drag.zoom = state.timeZoom;
      drag.moved = true;
    }
  });

  els.stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !state.view || !drag) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.dist > 8) {
        state.timeZoom = clamp(drag.zoom * (dist / drag.dist), 0.15, 6);
        els.timeZoom.value = state.timeZoom.toFixed(2);
        requestRender();
      }
      return;
    }
    const now = performance.now();
    const dx = event.clientX - drag.lastX;
    const dt = now - drag.lastTime || 16;
    drag.lastX = event.clientX;
    drag.lastTime = now;
    if (Math.abs(event.clientX - drag.startX) > 4) drag.moved = true;
    const layoutDx = (event.clientX - drag.startX) / state.timeZoom;
    const hairX = drag.startHairX + (els.mirror.checked ? layoutDx : -layoutDx);
    state.hairlineTime = timeAtX(state.view.layout, hairX);
    state.inertia = ((els.mirror.checked ? dx : -dx) / state.timeZoom) / dt;
    requestRender();
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size > 0) return;
    if (!drag?.moved && event.type === "pointerup") {
      /* A tap on empty photo keeps the current line. */
    }
    if (drag && Math.abs(state.inertia) > 0.02 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const velocity = state.inertia;
      const step = (stamp) => {
        if (!state.inertia || state.screen !== "review") return;
        const hairX = xAtTime(state.view.layout, state.hairlineTime) + state.inertia * 16;
        state.hairlineTime = timeAtX(state.view.layout, hairX);
        state.inertia *= 0.92;
        if (Math.abs(state.inertia) < 0.01) state.inertia = 0;
        requestRender();
        if (state.inertia) requestAnimationFrame(step);
        return stamp;
      };
      state.inertia = velocity;
      requestAnimationFrame(step);
    }
    drag = null;
  };
  els.stage.addEventListener("pointerup", endPointer);
  els.stage.addEventListener("pointercancel", endPointer);

  els.stage.addEventListener(
    "wheel",
    (event) => {
      if (!state.view) return;
      event.preventDefault();
      const dx = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const hairX = xAtTime(state.view.layout, state.hairlineTime) + dx / state.timeZoom;
      state.hairlineTime = timeAtX(state.view.layout, hairX);
      requestRender();
    },
    { passive: false },
  );

  els.marksLayer.addEventListener("pointerdown", (event) => {
    const label = event.target.closest(".mark-label");
    if (!label) return;
    event.stopPropagation();
    selectMark(label.dataset.id, false);
    const mark = state.marks.find((item) => item.id === label.dataset.id);
    const originX = event.clientX;
    const originTime = mark.time;
    const move = (ev) => {
      const layoutDx = (ev.clientX - originX) / state.timeZoom;
      const photoDx = els.mirror.checked ? -layoutDx : layoutDx;
      const [minT, maxT] = timeBounds();
      const x = xAtTime(state.view.layout, originTime) + photoDx;
      mark.time = clamp(timeAtX(state.view.layout, x), minT, maxT);
      state.hairlineTime = mark.time;
      requestRender();
      renderResults();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function requestRender() {
  if (state.drawQueued) return;
  state.drawQueued = true;
  requestAnimationFrame(() => {
    state.drawQueued = false;
    renderReview();
  });
}

function bindCameraGestures() {
  const pointers = new Map();
  let drag = null;
  els.preview.addEventListener("pointerdown", (event) => {
    if (state.capturing || state.lock) return;
    els.preview.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { x: event.clientX, y: event.clientY, slit: state.slitNorm, pan: state.panYNorm, zoom: state.camZoom, dist: 0 };
    } else if (pointers.size === 2 && drag) {
      const [a, b] = [...pointers.values()];
      drag.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  els.preview.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !drag || state.lock) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = els.preview.getBoundingClientRect();
    if (pointers.size >= 2 && drag.dist > 8) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      state.camZoom = clamp(drag.zoom * (dist / drag.dist), 1, 4);
      els.camZoom.value = String(state.camZoom);
      els.zoomValue.textContent = `${state.camZoom.toFixed(1)}×`;
      return;
    }
    const frW = (els.video.videoWidth || 1) / state.camZoom;
    const frH = (els.video.videoHeight || 1) / state.camZoom;
    state.slitNorm = clamp(drag.slit + ((event.clientX - drag.x) / rect.width) * (frW / (els.video.videoWidth || 1)), 0.04, 0.96);
    state.panYNorm = clamp(drag.pan + ((event.clientY - drag.y) / rect.height) * (frH / (els.video.videoHeight || 1)), 0, 1);
    els.line.value = String(state.slitNorm * 100);
    els.lineValue.textContent = `${Math.round(state.slitNorm * 100)}%`;
    drawPreview();
  });
  const end = (event) => pointers.delete(event.pointerId);
  els.preview.addEventListener("pointerup", end);
  els.preview.addEventListener("pointercancel", end);
}

function bindResults() {
  els.results.addEventListener("click", (event) => {
    const item = event.target.closest(".result");
    if (!item) return;
    if (event.target.closest(".icon-btn")) {
      removeMark(item.dataset.id);
      return;
    }
    if (event.target.closest("input")) return;
    selectMark(item.dataset.id, true);
  });
  els.results.addEventListener("input", (event) => {
    const item = event.target.closest(".result");
    if (!item || !event.target.classList.contains("bib")) return;
    const mark = state.marks.find((entry) => entry.id === item.dataset.id);
    if (mark) mark.name = event.target.value;
  });
}

function bindKeyboard() {
  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) return;
    if (state.screen === "camera" && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      els.primary.click();
    }
    if (state.screen !== "review") return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const sign = event.key === "ArrowLeft" ? -1 : 1;
      nudge(sign * (event.shiftKey ? 0.1 : 0.01));
    } else if (event.key === "m" || event.key === "M") {
      addMark();
    } else if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
      event.preventDefault();
      removeMark(state.selectedId);
    }
  });
}

function startPractice() {
  els.practice.disabled = true;
  const original = els.practice.textContent;
  els.practice.textContent = "正在建立練習終點…";
  try {
    const demo = createDemoRecording();
    enterReview(demo.store, { demo: true, eventName: state.settings.eventName || "練習" });
  } catch (error) {
    toast(error.message || "無法建立練習終點");
  } finally {
    els.practice.disabled = false;
    els.practice.textContent = original;
  }
}

function bind() {
  applyHomeSettings();
  els.eventName.addEventListener("input", () => {
    state.settings.eventName = els.eventName.value;
    syncEventPicks();
    saveSettings();
  });
  els.eventPick.addEventListener("click", () => {
    const open = els.eventOptions.hidden;
    els.eventOptions.hidden = !open;
    els.eventPick.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll("[data-event-value]").forEach((button) => {
    button.addEventListener("click", () => setEventPick(button.dataset.eventGroup, button.dataset.eventValue));
  });
  els.handsFree.addEventListener("change", () => {
    state.settings.handsFree = els.handsFree.checked;
    saveSettings();
  });
  document.querySelectorAll("[data-start]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.startMode = button.dataset.start;
      saveSettings();
      applyHomeSettings();
    });
  });
  document.querySelectorAll("[data-buffer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.settings.bufferMode = button.dataset.buffer;
      state.settings.sliceWidth = state.settings.bufferMode === "long" ? 5 : 7;
      saveSettings();
      applyHomeSettings();
    });
  });
  els.openCamera.addEventListener("click", () => openCamera());
  els.practice.addEventListener("click", () => startPractice());
  els.openHelp.addEventListener("click", () => openHelp());
  els.closeCamera.addEventListener("click", () => leaveCamera());
  els.cameraRetry.addEventListener("click", () => {
    hideCameraError();
    startStream();
  });
  els.cameraPractice.addEventListener("click", () => {
    shutdownCamera();
    startPractice();
  });
  els.primary.addEventListener("click", () => {
    if (state.countdownTimer) {
      cancelCountdown();
      return;
    }
    if (state.listening && state.clockStart == null) {
      state.listening = false;
      stopAudioInput();
      syncCameraControls();
      return;
    }
    if (state.clockStart == null) {
      beginStart();
      return;
    }
    if (!state.store && !state.capturing) {
      startCapture();
      return;
    }
    stopAndBuild();
  });
  els.secondary.addEventListener("click", () => togglePause());
  els.discard.addEventListener("click", () => discardRace());
  els.line.addEventListener("input", () => {
    if (state.lock) return;
    state.slitNorm = Number(els.line.value) / 100;
    els.lineValue.textContent = `${Math.round(state.slitNorm * 100)}%`;
    drawPreview();
  });
  els.camZoom.addEventListener("input", () => {
    if (state.lock) return;
    state.camZoom = Number(els.camZoom.value);
    els.zoomValue.textContent = `${state.camZoom.toFixed(1)}×`;
    drawPreview();
  });
  els.sensitivity.addEventListener("input", () => {
    els.sensitivityValue.textContent = Number(els.sensitivity.value).toFixed(2);
  });
  document.querySelectorAll("[data-delta]").forEach((button) => {
    button.addEventListener("click", () => nudge(Number(button.dataset.delta)));
  });
  els.markBtn.addEventListener("click", () => addMark());
  els.slice.addEventListener("input", () => applyViewOptions());
  els.slit.addEventListener("input", () => applyViewOptions());
  els.timeZoom.addEventListener("input", () => {
    state.timeZoom = Number(els.timeZoom.value);
    requestRender();
  });
  els.magnify.addEventListener("input", () => {
    state.magnify = Number(els.magnify.value);
    requestRender();
  });
  els.mirror.addEventListener("change", () => {
    state.settings.mirror = els.mirror.checked;
    saveSettings();
    requestRender();
  });
  els.delay.addEventListener("input", () => {
    state.settings.lateBy = Number(els.delay.value);
    saveSettings();
    renderResults();
    requestRender();
  });
  document.querySelectorAll("[data-delay]").forEach((button) => {
    button.addEventListener("click", () => {
      els.delay.value = button.dataset.delay;
      els.delay.dispatchEvent(new Event("input"));
    });
  });
  els.clearMarks.addEventListener("click", () => {
    state.marks = [];
    state.selectedId = null;
    renderResults();
    renderReview();
  });
  els.newRace.addEventListener("click", () => {
    revokeSnapshots();
    state.view = null;
    state.marks = [];
    show("home");
  });
  els.takeSnapshot.addEventListener("click", () => takeSnapshot());
  els.saveLiveSnapshot.addEventListener("click", () => saveSnapshotFile(state.snapshots.at(-1)));
  els.saveSnapshot.addEventListener("click", () => saveSnapshotFile(snapshotAt(state.hairlineTime)));
  els.savePhoto.addEventListener("click", () => savePhoto());
  els.saveCsv.addEventListener("click", () => saveCsv());
  els.shareBtn.addEventListener("click", () => shareFinish());
  bindCameraGestures();
  bindReviewGestures();
  bindResults();
  bindKeyboard();
  resizeObserver = new ResizeObserver(() => {
    if (state.screen === "review") requestRender();
  });
  resizeObserver.observe(els.photoWrap);
  if (els.cameraFeed) {
    const feedObserver = new ResizeObserver(() => {
      if (state.screen === "camera" && els.video.videoWidth) drawPreview();
    });
    feedObserver.observe(els.cameraFeed);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.screen === "camera" && state.clockStart != null) {
      stayAwake();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.capturing || (state.screen === "camera" && state.clockStart != null)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  if (new URLSearchParams(location.search).has("demo")) startPractice();
}

previewCtx = els.preview.getContext("2d");
photoCtx = els.photo.getContext("2d");
rulerCtx = els.ruler.getContext("2d");
bind();
