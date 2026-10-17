/** Photo-finish geometry.
 * Each captured frame is one look at the finish line. Slices are laid out on a
 * time axis: the centre of a frame's slice is that frame's timestamp, and one
 * pixel across a slice is (frame interval / slice width) seconds.
 * Long pauses become a narrow gap so they don't stretch the picture.
 */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function medianDelta(times) {
  const all = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.0004) all.push(d);
  }
  if (!all.length) return 1 / 30;
  all.sort((a, b) => a - b);
  const mid = (arr) => arr[Math.floor(arr.length / 2)];
  const typical = all.filter((d) => d < 0.5);
  if (typical.length >= Math.max(3, all.length * 0.5)) return mid(typical);
  return mid(all);
}

const GAP_PX = 18;

export function buildLayout(times, sliceWidth) {
  const sw = Math.max(1, sliceWidth);
  const n = times.length;
  const dt = medianDelta(times);
  const spp = dt / sw;
  const threshold = Math.max(0.25, dt * 8);
  const empty = {
    secPerPixel: spp,
    dt,
    sliceWidth: sw,
    totalWidth: 0,
    segments: [],
    gaps: [],
    frameX: new Float64Array(),
    frameW: new Float64Array(),
  };
  if (!n) return empty;

  const segments = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    const split =
      i === n || times[i] - times[i - 1] > threshold || times[i] <= times[i - 1];
    if (!split) continue;
    segments.push({ frameStart: start, frameEnd: i - 1 });
    start = i;
  }

  let x = 0;
  const gaps = [];
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const tFirst = times[seg.frameStart];
    const tLast = times[seg.frameEnd];
    const span = Math.max(0, (tLast - tFirst) / spp);
    seg.t0 = tFirst;
    seg.tFirst = tFirst;
    seg.tLast = tLast;
    seg.secPerPixel = spp;
    seg.x0 = x;
    seg.center0 = x + sw / 2;
    seg.x1 = seg.center0 + span + sw / 2;
    x = seg.x1;
    if (s < segments.length - 1) {
      gaps.push({
        x0: x,
        x1: x + GAP_PX,
        tBefore: tLast,
        tAfter: times[segments[s + 1].frameStart],
      });
      x += GAP_PX;
    }
  }

  const frameX = new Float64Array(n);
  const frameW = new Float64Array(n);
  for (const seg of segments) {
    const count = seg.frameEnd - seg.frameStart + 1;
    const centers = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      centers[k] = seg.center0 + (times[seg.frameStart + k] - seg.t0) / spp;
    }
    for (let k = 0; k < count; k++) {
      const center = centers[k];
      const left = k === 0 ? center - sw / 2 : (centers[k - 1] + center) / 2;
      const right =
        k === count - 1 ? center + sw / 2 : (center + centers[k + 1]) / 2;
      frameX[seg.frameStart + k] = left;
      frameW[seg.frameStart + k] = Math.max(0.25, right - left);
    }
  }

  return {
    secPerPixel: spp,
    dt,
    sliceWidth: sw,
    totalWidth: x,
    segments,
    gaps,
    frameX,
    frameW,
  };
}

export function timeAtX(layout, x) {
  const segs = layout.segments;
  if (!segs.length) return 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const next = segs[i + 1];
    if (next && x >= next.x0) continue;
    if (next && x >= seg.x1 && x < next.x0) return seg.tLast;
    const half = (seg.secPerPixel * layout.sliceWidth) / 2;
    const raw = seg.t0 + (x - seg.center0) * seg.secPerPixel;
    return Math.min(seg.tLast + half, Math.max(seg.tFirst - half, raw));
  }
  return segs[segs.length - 1].tLast;
}

export function xAtTime(layout, t) {
  const segs = layout.segments;
  if (!segs.length) return 0;
  if (t <= segs[0].tFirst) {
    return segs[0].center0 + (t - segs[0].t0) / segs[0].secPerPixel;
  }
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (t <= seg.tLast) return seg.center0 + (t - seg.t0) / seg.secPerPixel;
    if (i < segs.length - 1 && t < segs[i + 1].tFirst) return seg.x1;
  }
  const last = segs[segs.length - 1];
  return last.center0 + (t - last.t0) / last.secPerPixel;
}

export function gapAt(layout, x) {
  for (const gap of layout.gaps) {
    if (x >= gap.x0 && x < gap.x1) return gap;
  }
  return null;
}

export function droppedFrames(times, dt = medianDelta(times)) {
  let n = 0;
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > dt * 1.75) n += Math.max(0, Math.round(d / dt) - 1);
  }
  return n;
}

/** Race clock text. `digits` is the fractional second length (3 = milliseconds). */
export function formatRaceTime(seconds, digits = 3) {
  if (!Number.isFinite(seconds)) return "—";
  const sign = seconds < 0 ? -1 : 1;
  const factor = 10 ** digits;
  const units = Math.round(Math.abs(seconds) * factor + 1e-8);
  const frac = digits ? units % factor : 0;
  const totalSec = digits ? Math.floor(units / factor) : units;
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);
  const secStr = m > 0 ? String(s).padStart(2, "0") : String(s);
  const body = digits ? `${secStr}.${String(frac).padStart(digits, "0")}` : secStr;
  const text = (m > 0 ? `${m}:` : "") + body;
  return (sign < 0 ? "−" : "") + text;
}

export function screenToPhotoX({ viewLeft, viewW, screenPx, mirror }) {
  if (!mirror) return viewLeft + screenPx;
  return viewLeft + viewW - screenPx;
}

export function photoToScreenX({ viewLeft, viewW, photoX, mirror }) {
  if (!mirror) return photoX - viewLeft;
  return viewLeft + viewW - photoX;
}
