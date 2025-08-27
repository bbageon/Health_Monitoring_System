// src/result/ResultContainer.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResultPresenter from "./ResultPresenter";
import { getLastHourReadings } from "../store/readingStore";
import { fetchHealthSummary, normalizeStatus, Aggregates as AggrType } from "./GPT";

function avg(nums: number[]) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function classifyLocal(a: AggrType): "bad" | "fine" | "good" {
  const hr = a.hrMean ?? NaN;
  const bt = a.bodyMean ?? NaN; // bodyMean은 MLX Object 로직 유지
  if ((Number.isFinite(hr) && hr > 100) || (Number.isFinite(bt) && bt > 37.8)) return "bad";
  if (Number.isFinite(hr) && hr >= 55 && hr <= 85 && Number.isFinite(bt) && bt >= 36.0 && bt <= 37.2) return "good";
  return "fine";
}

export default function ResultContainer() {
  const { aggr, recentCount } = useMemo(() => {
    const now = Date.now();
    const from = now - 3600_000;
    const rows = getLastHourReadings(from, now);

    const hrMean = avg(rows.map((r) => r.heartRate));
    const bodyMean = avg(rows.map((r) => r.bodyTempC));        // MLX Object가 들어온다고 가정
    const ambMean = avg(rows.map((r) => r.ambientTempC));      // DHT
    const humidityMean = avg(rows.map((r) => (typeof r.humidity === "number" ? r.humidity : NaN)));

    const mlxObjMean = avg(rows.map((r) => (typeof r.mlxObjectC === "number" ? r.mlxObjectC : NaN)));
    const mlxAmbMean = avg(rows.map((r) => (typeof r.mlxAmbientC === "number" ? r.mlxAmbientC : NaN)));

    const coveragePct = Math.min(rows.length / 3600, 1);

    return {
      aggr: { hrMean, bodyMean, ambMean, humidityMean, mlxObjMean, mlxAmbMean, coveragePct } as AggrType,
      recentCount: rows.length,
    };
  }, []);

  // UI 상태
  const [status, setStatus] = useState<"bad" | "fine" | "good">(normalizeStatus(classifyLocal(aggr)));
  const [summary, setSummary] = useState<string[]>([]);
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState<string>("");

  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // 실행 제어
  const hasRunRef = useRef(false);
  const inFlightRef = useRef(false);

  const runLLM = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setLastError(null);

    try {
      // 데이터 가드
      const MIN_SAMPLES = 1;
      const MIN_COVERAGE = 0.001;

      if (recentCount < MIN_SAMPLES || aggr.coveragePct < MIN_COVERAGE) {
        const msg =
          `데이터가 충분하지 않습니다. (need≥${MIN_SAMPLES}, got=${recentCount}; ` +
          `coverage≥${(MIN_COVERAGE * 100).toFixed(0)}%, got=${(aggr.coveragePct * 100).toFixed(0)}%)`;

        const localStatus = normalizeStatus(classifyLocal(aggr));
        setStatus(localStatus);

        setSummary([
          "Not enough data to generate a full AI summary.",
          `HR ${aggr.hrMean?.toFixed(0) ?? "--"} bpm • Body ${aggr.bodyMean?.toFixed(2) ?? "--"} °C • Amb ${aggr.ambMean?.toFixed(2) ?? "--"} °C • Hum ${aggr.humidityMean?.toFixed(1) ?? "--"} %`,
        ]);
        setGuidelines([]);
        setDisclaimer("");

        setReport(
          `${msg}\n` +
          `• HR avg: ${aggr.hrMean?.toFixed(0) ?? "--"} bpm\n` +
          `• Body: ${aggr.bodyMean?.toFixed(2) ?? "--"} °C\n` +
          `• Amb/Hum: ${aggr.ambMean?.toFixed(2) ?? "--"} °C / ${aggr.humidityMean?.toFixed(1) ?? "--"} %\n` +
          (aggr.mlxObjMean != null || aggr.mlxAmbMean != null
            ? `• MLX Obj/Amb: ${aggr.mlxObjMean?.toFixed(2) ?? "--"} °C / ${aggr.mlxAmbMean?.toFixed(2) ?? "--"} °C\n`
            : "") +
          `• Coverage: ${(aggr.coveragePct * 100).toFixed(0)}%`
        );
        return;
      }

      // ——— OpenAI 호출(서비스 분리) ——— //
      const res = await fetchHealthSummary(aggr);
      setStatus(res.status);
      setSummary(res.summary);
      setGuidelines(res.guidelines);
      setDisclaimer(res.disclaimer);
      setReport("");

    } catch (e: any) {
      const msg =
        e?.status === 429
          ? "요청이 너무 많습니다(429). 잠시 후 다시 시도해주세요."
          : (e?.message || "알 수 없는 오류가 발생했습니다.");
      setLastError(msg);

      const localStatus = normalizeStatus(classifyLocal(aggr));
      setStatus(localStatus);
      setSummary([]);
      setGuidelines([]);
      setDisclaimer("");
      setReport(
        `로컬 분석 결과로 대체합니다.\n` +
        `• HR avg: ${aggr.hrMean?.toFixed(0) ?? "--"} bpm\n` +
        `• Body: ${aggr.bodyMean?.toFixed(2) ?? "--"} °C\n` +
        `• Amb/Hum: ${aggr.ambMean?.toFixed(2) ?? "--"} °C / ${aggr.humidityMean?.toFixed(1) ?? "--"} %\n` +
        (aggr.mlxObjMean != null || aggr.mlxAmbMean != null
          ? `• MLX Obj/Amb: ${aggr.mlxObjMean?.toFixed(2) ?? "--"} °C / ${aggr.mlxAmbMean?.toFixed(2) ?? "--"} °C\n`
          : "")
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [aggr, recentCount]);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    runLLM(); // 화면 진입 시 1회 자동 생성
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
    />
  );
}
