import type { SensorReading } from "../types";

/**
 * In-memory ring buffer (sliding 1h window) + outlier filtering.
 * - Drops values outside physical bounds
 * - Drops values that jump too much vs previous sample
 * - (Optional) Hampel filter against recent median ± T * MAD
 */

// ===================== Config =====================

// Keep only last 1 hour of data
const WINDOW_MS = 3600_000;

// Physical plausible bounds (hard range)
const BOUNDS = {
  hr:   { min: 30, max: 220 },
  body: { min: 20, max: 42 },   // ← 30 → 20
  amb:  { min: -30, max: 60 },
  hum:  { min: 0,  max: 100 },
};

// Previous-sample jump limits (absolute diff vs previous sample)
// -> If your sampling is ~1 Hz, these are per-sample limits.
// Tune based on your sensors & use-case.
const JUMP = {
  hr: 50,      // bpm per sample (use 50 if intense exercise expected)
  body: 1,   // °C per sample
  amb: 2.0,    // °C per sample
  hum: 15,     // % per sample
};

// Optional: rate-of-change per second limits (if timestamps vary).
// If you want only absolute-diff rule, set these to very large numbers.
const ROC_PER_SEC = {
  hr: 40,      // bpm per second
  body: 0.6,   // °C per second
  amb: 3.0,    // °C per second
  hum: 20,     // % per second
};

// Optional Hampel filter (median ± T * MAD on last K samples)
const USE_HAMPEL = false; // set true to enable
const HAMPEL_K = 9;       // window size
const HAMPEL_T = 3.0;     // threshold multiplier

// ===================== Buffer =====================

const buf: SensorReading[] = [];

// ===================== Helpers =====================

function isFiniteNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function inBounds(v: number | null | undefined, min: number, max: number) {
  return isFiniteNum(v) && v >= min && v <= max;
}

function absJumpTooLarge(prev: number | null | undefined, cur: number | null | undefined, limit: number) {
  if (!isFiniteNum(prev) || !isFiniteNum(cur)) return false;
  return Math.abs(cur - prev) > limit;
}

function rocTooLarge(prevVal: number | null | undefined, curVal: number | null | undefined, dtSec: number, limitPerSec: number) {
  if (!isFiniteNum(prevVal) || !isFiniteNum(curVal) || dtSec <= 0) return false;
  const maxAllowed = limitPerSec * dtSec;
  return Math.abs(curVal - prevVal) > maxAllowed;
}

function median(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function mad(arr: number[], med: number): number {
  const absDev = arr.map((x) => Math.abs(x - med));
  // 1.4826 ~ scale factor to make MAD comparable to std dev under normality
  return 1.4826 * median(absDev);
}

function hampelOutlier(current: number, series: number[]): boolean {
  const tail = series.filter(isFiniteNum).slice(-HAMPEL_K);
  if (!isFiniteNum(current) || tail.length < Math.max(5, Math.floor(HAMPEL_K / 2))) return false;
  const med = median(tail);
  const m = mad(tail, med) || 1e-6; // avoid zero
  return Math.abs(current - med) > HAMPEL_T * m;
}

function pruneOld() {
  const cutoff = Date.now() - WINDOW_MS;
  while (buf.length && (buf[0].timestamp ?? 0) < cutoff) buf.shift();
}

// ===================== Public API =====================

/**
 * Add one reading to the buffer, dropping outliers.
 * Rules order:
 *  1) Range check (physical bounds)
 *  2) Jump check vs previous sample (absolute diff)
 *  3) ROC check vs previous sample (per second)
 *  4) (Optional) Hampel median/MAD filter
 */
export function addReading(r: SensorReading) {
  // Basic validity
  if (
    !isFiniteNum(r.heartRate) ||
    !isFiniteNum(r.bodyTempC) ||
    !isFiniteNum(r.ambientTempC) ||
    !isFiniteNum(r.timestamp)
  ) {
    console.warn("[readingStore] dropped (invalid number):", r);
    pruneOld();
    return;
  }
  // Range check
  if (
    !inBounds(r.heartRate, BOUNDS.hr.min, BOUNDS.hr.max) ||
    !inBounds(r.bodyTempC, BOUNDS.body.min, BOUNDS.body.max) ||
    !inBounds(r.ambientTempC, BOUNDS.amb.min, BOUNDS.amb.max) ||
    (r.humidity != null && !inBounds(r.humidity as number, BOUNDS.hum.min, BOUNDS.hum.max))
  ) {
    console.warn("[readingStore] dropped (bounds):", r);
    pruneOld();
    return;
  }

  const prev = buf.at(-1);
  if (prev) {
    const dtSec = Math.max(0.001, (r.timestamp - prev.timestamp) / 1000); // guard zero

    // Absolute jump vs previous sample
    if (
      absJumpTooLarge(prev.heartRate, r.heartRate, JUMP.hr) ||
      absJumpTooLarge(prev.bodyTempC, r.bodyTempC, JUMP.body) ||
      absJumpTooLarge(prev.ambientTempC, r.ambientTempC, JUMP.amb) ||
      (isFiniteNum(prev.humidity) && isFiniteNum(r.humidity) && absJumpTooLarge(prev.humidity, r.humidity, JUMP.hum))
    ) {
      console.warn("[readingStore] dropped (jump):", r);
      pruneOld();
      return;
    }

    // Rate-of-change per second (handles variable sampling intervals)
    if (
      rocTooLarge(prev.heartRate, r.heartRate, dtSec, ROC_PER_SEC.hr) ||
      rocTooLarge(prev.bodyTempC, r.bodyTempC, dtSec, ROC_PER_SEC.body) ||
      rocTooLarge(prev.ambientTempC, r.ambientTempC, dtSec, ROC_PER_SEC.amb) ||
      (isFiniteNum(prev.humidity) && isFiniteNum(r.humidity) && rocTooLarge(prev.humidity, r.humidity, dtSec, ROC_PER_SEC.hum))
    ) {
      console.warn("[readingStore] dropped (roc):", r);
      pruneOld();
      return;
    }
  }

  // Optional Hampel filter (recent history-based)
  if (USE_HAMPEL) {
    const hrSeries = buf.map((x) => x.heartRate);
    const bodySeries = buf.map((x) => x.bodyTempC);
    const ambSeries = buf.map((x) => x.ambientTempC);
    const humSeries = buf.map((x) => (x.humidity ?? NaN));

    if (
      hampelOutlier(r.heartRate, hrSeries) ||
      hampelOutlier(r.bodyTempC, bodySeries) ||
      hampelOutlier(r.ambientTempC, ambSeries) ||
      (isFiniteNum(r.humidity) && hampelOutlier(r.humidity as number, humSeries))
    ) {
      console.warn("[readingStore] dropped (hampel):", r);
      pruneOld();
      return false;
    }
  }

  // Passed all checks → accept
  buf.push(r);
  pruneOld();
  return true;
}


export function getBufferSize() {
  return buf.length;
}

/** Query readings within [from, to] (inclusive) */
export function getLastHourReadings(from: number, to: number) {
  return buf.filter((r) => (r.timestamp ?? 0) >= from && (r.timestamp ?? 0) <= to);
}

/** (Optional) for debugging in dev screen */
export function _debugBuffer() {
  return { size: buf.length, head: buf[0], tail: buf.at(-1) };
}
