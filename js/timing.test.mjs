import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLayout,
  droppedFrames,
  formatRaceTime,
  gapAt,
  photoToScreenX,
  screenToPhotoX,
  timeAtX,
  xAtTime,
} from "./timing.js";

function uniform(start, count, dt) {
  return Float64Array.from({ length: count }, (_, i) => start + i * dt);
}

test("frame centres land on their timestamps", () => {
  const times = uniform(0, 61, 1 / 60);
  const layout = buildLayout(times, 10);
  for (const index of [0, 1, 30, 60]) {
    const center = layout.frameX[index] + layout.frameW[index] / 2;
    assert.ok(Math.abs(timeAtX(layout, center) - times[index]) < 1e-9);
    assert.ok(Math.abs(xAtTime(layout, times[index]) - center) < 1e-9);
  }
});

test("time is linear between frames and round-trips", () => {
  const times = uniform(2, 10, 0.1);
  const layout = buildLayout(times, 10);
  const x0 = xAtTime(layout, 2);
  const x1 = xAtTime(layout, 2.1);
  const mid = (x0 + x1) / 2;
  assert.ok(Math.abs(timeAtX(layout, mid) - 2.05) < 1e-9);
  for (const x of [3, 10.5, 40, layout.totalWidth - 2]) {
    assert.ok(Math.abs(xAtTime(layout, timeAtX(layout, x)) - x) < 1e-6);
  }
});

test("a pause becomes a gap instead of empty race time", () => {
  const times = Float64Array.of(0, 0.1, 5, 5.1);
  const layout = buildLayout(times, 10);
  assert.equal(layout.segments.length, 2);
  assert.equal(layout.gaps.length, 1);
  assert.ok(layout.totalWidth < 80, `width ${layout.totalWidth} should stay compact`);
  assert.ok(Math.abs(timeAtX(layout, xAtTime(layout, 5)) - 5) < 1e-9);
  assert.ok(gapAt(layout, layout.gaps[0].x0 + 1));
  const spanned = (5.1 / layout.secPerPixel);
  assert.ok(layout.totalWidth * 4 < spanned, "pause must not be drawn as empty track");
});

test("mirror mapping round-trips", () => {
  const args = { viewLeft: 40, viewW: 200, mirror: true };
  for (const screenPx of [0, 20, 100, 200]) {
    const photo = screenToPhotoX({ ...args, screenPx });
    assert.equal(photoToScreenX({ ...args, photoX: photo }), screenPx);
  }
});

test("clock formatting rounds to the requested decimal", () => {
  assert.equal(formatRaceTime(10), "10.000");
  assert.equal(formatRaceTime(10.2566), "10.257");
  assert.equal(formatRaceTime(9.9996), "10.000");
  assert.equal(formatRaceTime(65.2, 1), "1:05.2");
  assert.equal(formatRaceTime(-0.2, 2), "−0.20");
  assert.equal(formatRaceTime(Number.NaN), "—");
});

test("dropped frames are counted from the median interval", () => {
  const times = Float64Array.of(0, 0.1, 0.2, 0.5, 0.6);
  assert.equal(droppedFrames(times, 0.1), 2);
});
