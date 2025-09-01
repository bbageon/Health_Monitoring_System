// src/store/readingStore.ts
import type { SensorReading } from "../types";

/**
 * In-memory ring buffer (sliding 1h window) + outlier filtering.
 * - Drops values outside physical bounds
 * - Soft-clamps excessive jumps/ROC (within tolerance) instead of hard drop
 * - (Optional) Hampel filter against recent median ± T * MAD
 */

// ===================== Config =====================

// Keep only last 1 hour of data
const WINDOW_MS = 3600_000;

// Physical plausible bounds (hard range)
const BOUNDS = {
  hr:   { min: 30, max: 220 },
  body: { min: 20, max: 42 },
  amb:  { min: -30, max: 60 },
  hum:  { min: 0,  max: 100 },
};

// Previous-sample jump limits (absolute diff vs previous sample)
const JUMP = {
  hr: 50,     // bpm per sample (use 50 if intense exercise expected)
  body: 1,    // °C per sample
  amb: 2.0,   // °C per sample
  hum: 15,    // % per sample
};

// Rate-of-change per second limits (if timestamps vary)
const ROC_PER_SEC = {
  hr: 40,     // bpm per second
  body: 0.6,  // °C per second
  amb: 3.0,   // °C per second
  hum: 20,    // % per second
};

// Optional Hampel filter (median ± T * MAD on last K samples)
const USE_HAMPEL = false;
const HAMPEL_K = 9;
const HAMPEL_T = 3.0;

// Relaxation (demo-friendly): clamp instead of dropping if within tolerance
const RELAX = {
  skipChecksIfPrevOlderThanMs: 5000, // if prev sample is too old, skip jump/roc checks
  jumpClampFactor: 1.5,              // accept up to (limit * factor) by clamping
  rocClampFactor: 1.5,               // accept up to (limit * factor) by clamping
};

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

function softClampToward(prev: number, cur: number, limit: number) {
  const delta = cur - prev;
  if (Math.abs(delta) <= limit) return cur;
  return prev + Math.sign(delta) * limit;
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
 *  2) Jump check vs previous sample (absolute diff)    → soft clamp if within tolerance
 *  3) ROC check vs previous sample (per second)        → soft clamp if within tolerance
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

  // Range check (hard)
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
    const dtMs = r.timestamp - prev.timestamp;
    const dtSec = Math.max(0.001, dtMs / 1000);
    const prevIsStale = dtMs > RELAX.skipChecksIfPrevOlderThanMs;

    let hr = r.heartRate;
    let body = r.bodyTempC;
    let amb = r.ambientTempC;
    let hum = r.humidity;

    if (!prevIsStale) {
      // ----- Absolute jump checks with soft clamp -----
      const hrJump = Math.abs(hr - prev.heartRate);
      const bodyJump = Math.abs(body - prev.bodyTempC);
      const ambJump = Math.abs(amb - prev.ambientTempC);
      const humJump =
        isFiniteNum(hum) && isFiniteNum(prev.humidity) ? Math.abs((hum as number) - (prev.humidity as number)) : 0;

      if (hrJump > JUMP.hr) {
        hr = softClampToward(prev.heartRate, hr, JUMP.hr);
        // if (hrJump <= JUMP.hr * RELAX.jumpClampFactor) {
        //   hr = softClampToward(prev.heartRate, hr, JUMP.hr);
        // } else {
        //   console.warn("[readingStore] dropped (jump-hr):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (bodyJump > JUMP.body) {
        softClampToward(prev.bodyTempC, body, JUMP.body);
        // if (bodyJump <= JUMP.body * RELAX.jumpClampFactor) {
        //   body = softClampToward(prev.bodyTempC, body, JUMP.body);
        // } else {
        //   console.warn("[readingStore] dropped (jump-body):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (ambJump > JUMP.amb) {
        softClampToward(prev.ambientTempC, amb, JUMP.amb);
        // if (ambJump <= JUMP.amb * RELAX.jumpClampFactor) {
        //   amb = softClampToward(prev.ambientTempC, amb, JUMP.amb);
        // } else {
        //   console.warn("[readingStore] dropped (jump-amb):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (isFiniteNum(hum) && isFiniteNum(prev.humidity) && humJump > JUMP.hum) {
        hum = softClampToward(prev.humidity as number, hum as number, JUMP.hum);
        // if (humJump <= JUMP.hum * RELAX.jumpClampFactor) {
        //   hum = softClampToward(prev.humidity as number, hum as number, JUMP.hum);
        // } else {
        //   console.warn("[readingStore] dropped (jump-hum):", r);
        //   pruneOld();
        //   return;
        // }
      }

      // ----- ROC checks with soft clamp -----
      const maxHr = ROC_PER_SEC.hr * dtSec;
      const maxBody = ROC_PER_SEC.body * dtSec;
      const maxAmb = ROC_PER_SEC.amb * dtSec;
      const maxHum = ROC_PER_SEC.hum * dtSec;

      const hrROC = Math.abs(hr - prev.heartRate);
      const bodyROC = Math.abs(body - prev.bodyTempC);
      const ambROC = Math.abs(amb - prev.ambientTempC);
      const humROC =
        isFiniteNum(hum) && isFiniteNum(prev.humidity) ? Math.abs((hum as number) - (prev.humidity as number)) : 0;

      if (hrROC > maxHr) {
        softClampToward(prev.heartRate, hr, maxHr);
        // if (hrROC <= maxHr * RELAX.rocClampFactor) {
        //   hr = softClampToward(prev.heartRate, hr, maxHr);
        // } else {
        //   console.warn("[readingStore] dropped (roc-hr):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (bodyROC > maxBody) {
        body = softClampToward(prev.bodyTempC, body, maxBody);
        // if (bodyROC <= maxBody * RELAX.rocClampFactor) {
        //   body = softClampToward(prev.bodyTempC, body, maxBody);
        // } else {
        //   console.warn("[readingStore] dropped (roc-body):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (ambROC > maxAmb) {
        amb = softClampToward(prev.ambientTempC, amb, maxAmb);
        // if (ambROC <= maxAmb * RELAX.rocClampFactor) {
        //   amb = softClampToward(prev.ambientTempC, amb, maxAmb);
        // } else {
        //   console.warn("[readingStore] dropped (roc-amb):", r);
        //   pruneOld();
        //   return;
        // }
      }
      if (isFiniteNum(hum) && isFiniteNum(prev.humidity) && humROC > maxHum) {
        hum = softClampToward(prev.humidity as number, hum as number, maxHum);
        // if (humROC <= maxHum * RELAX.rocClampFactor) {
        //   hum = softClampToward(prev.humidity as number, hum as number, maxHum);
        // } else {
        //   console.warn("[readingStore] dropped (roc-hum):", r);
        //   pruneOld();
        //   return;
        // }
      }

      // apply clamped values
      r = {
        ...r,
        heartRate: hr,
        bodyTempC: body,
        ambientTempC: amb,
        humidity: hum as number | undefined,
      };
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

// readingStore.ts
export function resetBuffer() {
  buf.length = 0;
}

