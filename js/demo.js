import { FrameStore } from "./store.js";

const RUNNERS = [
  { name: "12", time: 10, color: "#e23b3b", baseline: 130 },
  { name: "7", time: 10.25, color: "#2f6fed", baseline: 270 },
  { name: "21", time: 10.5, color: "#e6a317", baseline: 410 },
  { name: "3", time: 10.75, color: "#2ea043", baseline: 550 },
];

const SPEED = 180;

function drawRunner(ctx, frontX, baseline, color, bib) {
  const torsoW = 64;
  const torsoH = 56;
  const back = frontX - torsoW;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(back, baseline - 8, torsoW, 8);
  ctx.fillStyle = "#161b22";
  ctx.fillRect(back + 12, baseline - 36, 9, 36);
  ctx.fillRect(back + 36, baseline - 36, 9, 36);
  ctx.fillStyle = color;
  ctx.fillRect(back, baseline - 36 - torsoH, torsoW, torsoH);
  ctx.beginPath();
  ctx.arc(frontX - 18, baseline - 36 - torsoH - 15, 13, 0, Math.PI * 2);
  ctx.fillStyle = "#f2c7a6";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(back + 16, baseline - 36 - torsoH + 12, 32, 24);
  ctx.fillStyle = "#111418";
  ctx.font = "700 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(bib, back + 32, baseline - 36 - torsoH + 24);
  ctx.fillStyle = "#00ffff";
  ctx.fillRect(frontX, baseline - 36 - torsoH - 18, 1, torsoH + 54);
}

function drawScene(ctx, width, height, time, slit) {
  ctx.fillStyle = "#243044";
  ctx.fillRect(0, 0, width, 36);
  const laneTops = [36, 175, 315, 455];
  const laneColors = ["#7a3b34", "#8c463d", "#7a3b34", "#8c463d"];
  laneTops.forEach((top, i) => {
    ctx.fillStyle = laneColors[i];
    ctx.fillRect(0, top, width, i === laneTops.length - 1 ? height - top : 140);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(0, top, width, 2);
  });
  for (const runner of RUNNERS) {
    const frontX = slit + (time - runner.time) * SPEED;
    drawRunner(ctx, frontX, runner.baseline, runner.color, runner.name);
  }
}

function columnHasCyan(store, frameIndex) {
  const x = (store.band - 1) / 2;
  for (let y = 0; y < store.height; y++) {
    const off = store.frameOffset(frameIndex) + (y * store.band + x) * 4;
    const red = store.bytes[off];
    const green = store.bytes[off + 1];
    const blue = store.bytes[off + 2];
    if (red < 40 && green > 220 && blue > 220) return true;
  }
  return false;
}

/** Synthetic finish used to learn the screen and to check the time mapping. */
export function createDemoRecording() {
  const band = 21;
  const height = 580;
  const fps = 60;
  const t0 = 8;
  const t1 = 12;
  const frames = Math.round((t1 - t0) * fps);
  const store = new FrameStore(band, height, frames);
  const scene = document.createElement("canvas");
  scene.width = 960;
  scene.height = height;
  const sceneCtx = scene.getContext("2d", { willReadFrequently: true });
  const slit = 480;
  const capture = document.createElement("canvas");
  capture.width = band;
  capture.height = height;
  const captureCtx = capture.getContext("2d", { willReadFrequently: true });
  captureCtx.imageSmoothingEnabled = false;

  for (let i = 0; i < frames; i++) {
    const time = t0 + i / fps;
    drawScene(sceneCtx, scene.width, height, time, slit);
    const srcX = slit - (band - 1) / 2;
    captureCtx.drawImage(scene, srcX, 0, band, height, 0, 0, band, height);
    store.push(captureCtx.getImageData(0, 0, band, height).data, time);
  }

  const times = store.copyTimes();
  for (const runner of RUNNERS) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < times.length; i++) {
      const distance = Math.abs(times[i] - runner.time);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (bestDistance > 1 / fps / 2 + 1e-6 || !columnHasCyan(store, best)) {
      throw new Error(`Practice finish is misaligned for bib ${runner.name}`);
    }
  }

  return {
    store,
    fps,
    runners: RUNNERS.map((runner) => ({ ...runner })),
  };
}
