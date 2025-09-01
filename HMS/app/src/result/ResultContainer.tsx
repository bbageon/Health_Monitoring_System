import React, { useCallback, useEffect, useRef, useState } from "react";
import ResultPresenter from "./ResultPresenter";
import { getLastHourReadings, addReading, resetBuffer } from "../store/readingStore";
import { fetchHealthSummary, Aggregates as AggrType } from "./GPT";

function computeAggregates(): { aggr: AggrType; recentCount: number } {
  const now = Date.now();
  const from = now - 3600_000;
  const rows = getLastHourReadings(from, now);

  const avg = (ns: number[]) => {
    const a = ns.filter((n) => Number.isFinite(n));
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  };

  const hrMean = avg(rows.map((r) => r.heartRate));
  const bodyMean = avg(rows.map((r) => r.bodyTempC));
  const ambMean  = avg(rows.map((r) => r.ambientTempC));
  const humidityMean = avg(rows.map((r) => (typeof r.humidity === "number" ? r.humidity : NaN)));
  const mlxObjMean = avg(rows.map((r) => (typeof r.mlxObjectC === "number" ? r.mlxObjectC : NaN)));
  const mlxAmbMean = avg(rows.map((r) => (typeof r.mlxAmbientC === "number" ? r.mlxAmbientC : NaN)));
  const coveragePct = Math.min(rows.length / 3600, 1);

  return {
    aggr: { hrMean, bodyMean, ambMean, humidityMean, mlxObjMean, mlxAmbMean, coveragePct } as AggrType,
    recentCount: rows.length,
  };
}

export default function ResultContainer() {
  const [{ aggr, recentCount }, setAggrState] = useState(() => computeAggregates());

  // UI
  const [status, setStatus] = useState<"bad" | "fine" | "good" | "loading">("loading");
  const [summary, setSummary] = useState<string[]>([]);
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState<string>("");
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // process control
  const hasRunRef = useRef(false);
  const inFlightRef = useRef(false);

  // Update process when call LLM model
  const runLLM = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setLastError(null);
    setStatus("loading");

    try {
      const { aggr: curAggr, recentCount: curCount } = computeAggregates();
      setAggrState({ aggr: curAggr, recentCount: curCount });

      const MIN_SAMPLES = 1;
      const MIN_COVERAGE = 0.001;

      if (curCount < MIN_SAMPLES || curAggr.coveragePct < MIN_COVERAGE) {
        setSummary([
          "Not enough data to generate a full AI summary.",
          `HR ${curAggr.hrMean?.toFixed(0) ?? "--"} bpm • Body ${curAggr.bodyMean?.toFixed(2) ?? "--"} °C • Amb ${curAggr.ambMean?.toFixed(2) ?? "--"} °C • Hum ${curAggr.humidityMean?.toFixed(1) ?? "--"} %`,
        ]);
        setGuidelines([]);
        setDisclaimer("");
        setReport(
          `Samples: ${curCount} • Coverage: ${(curAggr.coveragePct * 100).toFixed(0)}%`
        );
        return;
      }

      const res = await fetchHealthSummary(curAggr);
      setStatus(res.status);
      setSummary(res.summary);
      setGuidelines(res.guidelines);
      setDisclaimer(res.disclaimer);
      setReport("");
    } catch (e: any) {
      setLastError(
        e?.status === 429
          ? "요청이 너무 많습니다(429). 잠시 후 다시 시도해주세요."
          : (e?.message || "알 수 없는 오류가 발생했습니다.")
      );
      setSummary([]);
      setGuidelines([]);
      setDisclaimer("");
      setReport("Falling back to local report (no AI).");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    runLLM();
  }, [runLLM]);

  /**
   * Test Data Set for Demoday
   */
  const injectScenario = useCallback(async (mode: "good" | "fine" | "bad-fever" | "bad-heat") => {
    resetBuffer();
    setStatus("loading");
    setSummary([]);
    setGuidelines([]);
    setDisclaimer("");
    setReport("");

    // 최근 10분, 1Hz로 샘플 채우기
    const now = Date.now();
    const start = now - 10 * 60_000;
    const N = 60 * 10;
    const dt = 1000;

    let target = { hr: 72, body: 36.7, amb: 24, hum: 40, mlxObj: 36.7, mlxAmb: 24 };
    if (mode === "fine")           target = { hr: 95,  body: 37.3, amb: 26, hum: 45, mlxObj: 37.3, mlxAmb: 26 };
    else if (mode === "bad-fever") target = { hr: 120, body: 38.2, amb: 25, hum: 45, mlxObj: 38.2, mlxAmb: 25 };
    else if (mode === "bad-heat")  target = { hr: 110, body: 37.4, amb: 32, hum: 75, mlxObj: 37.4, mlxAmb: 32 };

    const { aggr: curAggrBefore } = computeAggregates();
    const startVals = {
      hr: Number.isFinite(curAggrBefore.hrMean as number) ? (curAggrBefore.hrMean as number) : Math.max(50, target.hr - 10),
      body: Number.isFinite(curAggrBefore.bodyMean as number) ? (curAggrBefore.bodyMean as number) : Math.max(36.0, target.body - 0.3),
      amb: Number.isFinite(curAggrBefore.ambMean as number) ? (curAggrBefore.ambMean as number) : Math.max(18, target.amb - 2),
      hum: Number.isFinite(curAggrBefore.humidityMean as number) ? (curAggrBefore.humidityMean as number) : Math.max(35, target.hum - 5),
      mlxObj: Number.isFinite(curAggrBefore.mlxObjMean as number) ? (curAggrBefore.mlxObjMean as number) : Math.max(36.0, target.mlxObj - 0.3),
      mlxAmb: Number.isFinite(curAggrBefore.mlxAmbMean as number) ? (curAggrBefore.mlxAmbMean as number) : Math.max(18, target.mlxAmb - 2),
    };

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    for (let i = 0; i < N; i++) {
      const t = (i + 1) / N;
      const ts = start + i * dt;

      addReading({
        heartRate:    lerp(startVals.hr,     target.hr,     t),
        bodyTempC:    lerp(startVals.body,   target.body,   t),
        ambientTempC: lerp(startVals.amb,    target.amb,    t),
        humidity:     lerp(startVals.hum,    target.hum,    t),
        mlxObjectC:   lerp(startVals.mlxObj, target.mlxObj, t),
        mlxAmbientC:  lerp(startVals.mlxAmb, target.mlxAmb, t),
        timestamp: ts,
      } as any);
    }

    // Update data and call LLM
    setAggrState(computeAggregates());
    await runLLM();
  }, [runLLM]);

  return (
    <ResultPresenter
      aggr={aggr}
      recentCount={recentCount}
      status={status}
      summary={summary}
      guidelines={guidelines}
      disclaimer={disclaimer}
      report={report}
      loading={loading}
      lastError={lastError}
      onGenerate={runLLM}
      onDemo={injectScenario}
    />
  );
}
