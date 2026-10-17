import { buildLayout, clamp } from "./timing.js";

const TILE = 480;

export class FrameStore {
  constructor(band, height, maxFrames) {
    if (band < 1 || height < 1 || maxFrames < 2) {
      throw new Error("Invalid frame store size");
    }
    this.band = band;
    this.height = height;
    this.max = maxFrames;
    this.frameBytes = band * height * 4;
    this.bytes = new Uint8ClampedArray(maxFrames * this.frameBytes);
    this.times = new Float64Array(maxFrames);
    this.start = 0;
    this.count = 0;
    this.dropped = 0;
  }

  push(data, time) {
    if (data.length !== this.frameBytes) {
      throw new Error("Frame size does not match the store");
    }
    let index;
    if (this.count < this.max) {
      index = (this.start + this.count) % this.max;
      this.count += 1;
    } else {
      index = this.start;
      this.start = (this.start + 1) % this.max;
      this.dropped += 1;
    }
    this.bytes.set(data, index * this.frameBytes);
    this.times[index] = time;
    return this.dropped > 0;
  }

  frameOffset(chronologicalIndex) {
    const index = (this.start + chronologicalIndex) % this.max;
    return index * this.frameBytes;
  }

  copyTimes() {
    const out = new Float64Array(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.times[(this.start + i) % this.max];
    }
    return out;
  }

  oldestTime() {
    return this.count ? this.times[this.start] : 0;
  }

  newestTime() {
    if (!this.count) return 0;
    return this.times[(this.start + this.count - 1) % this.max];
  }
}

export function sliceSourceRect(band, sliceWidth, slitShift) {
  const slice = clamp(Math.round(sliceWidth), 1, band);
  const slit = (band - 1) / 2 + slitShift;
  let srcX = Math.round(slit - (slice - 1) / 2);
  srcX = clamp(srcX, 0, band - slice);
  return { srcX, srcW: slice };
}

export class PhotoView {
  constructor(store) {
    this.store = store;
    this.times = store.copyTimes();
    this.sliceWidth = Math.min(7, store.band);
    this.slitShift = 0;
    this.temp = document.createElement("canvas");
    this.temp.width = store.band;
    this.temp.height = store.height;
    this.tempCtx = this.temp.getContext("2d", { willReadFrequently: true });
    this.imageData = this.tempCtx.createImageData(store.band, store.height);
    this.cache = new Map();
    this.src = sliceSourceRect(store.band, this.sliceWidth, 0);
    this.layout = buildLayout(this.times, this.sliceWidth);
  }

  setOptions({ sliceWidth, slitShift }) {
    const slice = clamp(Math.round(sliceWidth), 1, this.store.band);
    const maxShift = Math.floor((this.store.band - slice) / 2);
    const shift = clamp(Math.round(slitShift), -maxShift, maxShift);
    if (slice === this.sliceWidth && shift === this.slitShift) return false;
    this.sliceWidth = slice;
    this.slitShift = shift;
    this.src = sliceSourceRect(this.store.band, slice, shift);
    this.layout = buildLayout(this.times, slice);
    this.cache.clear();
    return true;
  }

  maxSlitShift() {
    return Math.floor((this.store.band - this.sliceWidth) / 2);
  }

  draw(ctx, viewLeft, viewLayoutW, mirror) {
    const destW = ctx.canvas.width;
    const destH = ctx.canvas.height;
    const zoomDevice = destW / Math.max(1, viewLayoutW);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#10141b";
    ctx.fillRect(0, 0, destW, destH);
    ctx.save();
    if (mirror) {
      ctx.translate(destW, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingEnabled = zoomDevice < 0.92 || zoomDevice > 1.08;
    const x1 = viewLeft + viewLayoutW;
    const first = Math.floor(viewLeft / TILE);
    const last = Math.floor(x1 / TILE);
    const tileCount = Math.ceil(this.layout.totalWidth / TILE);
    for (let t = first; t <= last; t++) {
      if (t < 0 || t >= tileCount) continue;
      const tile = this.#tile(t);
      if (!tile) continue;
      const dx = (t * TILE - viewLeft) * zoomDevice;
      ctx.drawImage(tile, dx, 0, tile.width * zoomDevice, destH);
    }
    this.#drawGaps(ctx, viewLeft, zoomDevice, destW, destH);
    ctx.restore();
  }

  #tile(index) {
    const cached = this.cache.get(index);
    if (cached) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return cached;
    }
    const layout = this.layout;
    const x0 = index * TILE;
    const w = Math.min(TILE, Math.ceil(layout.totalWidth - x0));
    if (w <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, w);
    canvas.height = this.store.height;
    const tileCtx = canvas.getContext("2d");
    tileCtx.imageSmoothingEnabled = false;
    const i0 = this.#firstFrameOverlapping(x0);
    const i1 = this.#lastFrameOverlapping(x0 + w);
    for (let i = i0; i <= i1; i++) {
      const dx = layout.frameX[i] - x0;
      const dw = layout.frameW[i];
      if (dx + dw < 0 || dx > w) continue;
      this.#blit(tileCtx, i, dx, dw);
    }
    this.cache.set(index, canvas);
    while (this.cache.size > 10) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
    return canvas;
  }

  #firstFrameOverlapping(x) {
    const { frameX, frameW } = this.layout;
    let lo = 0;
    let hi = frameX.length - 1;
    let ans = frameX.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frameX[mid] + frameW[mid] >= x) {
        ans = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return ans;
  }

  #lastFrameOverlapping(x) {
    const { frameX } = this.layout;
    let lo = 0;
    let hi = frameX.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (frameX[mid] <= x) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  #blit(ctx, frameIndex, dx, dw) {
    const off = this.store.frameOffset(frameIndex);
    this.imageData.data.set(this.store.bytes.subarray(off, off + this.store.frameBytes));
    this.tempCtx.putImageData(this.imageData, 0, 0);
    const { srcX, srcW } = this.src;
    ctx.drawImage(this.temp, srcX, 0, srcW, this.store.height, dx, 0, dw, this.store.height);
  }

  #drawGaps(ctx, viewLeft, zoomDevice, destW, destH) {
    for (const gap of this.layout.gaps) {
      const dx = (gap.x0 - viewLeft) * zoomDevice;
      const dw = (gap.x1 - gap.x0) * zoomDevice;
      if (dw < 1 || dx > destW || dx + dw < 0) continue;
      ctx.fillStyle = "#07080c";
      ctx.fillRect(dx, 0, dw, destH);
      ctx.strokeStyle = "rgba(255, 176, 0, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 8 * Math.max(1, zoomDevice);
      for (let i = -destH; i < dw; i += step) {
        ctx.moveTo(dx + i, 0);
        ctx.lineTo(dx + i + destH * 0.4, destH);
      }
      ctx.stroke();
    }
  }
}
