import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResultPresenter from "./ResultPresenter";
import { getLastHourReadings, addReading } from "../store/readingStore";
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
    const bodyMean = avg(rows.map((r) => r.bodyTempC));        // MLX Object
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

  // ── UI 상태 ──────────────────────────────────────────────────────────────
  // GPT 응답 전에는 항상 "loading"을 보여주기 위해 초기값을 "loading"으로 둡니다.
  const [status, setStatus] = useState<"bad" | "fine" | "good" | "loading">("loading");
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
    setStatus("loading"); // ⬅️ 호출 시작 시 상태를 로딩으로 고정

    try {
      // 데이터 가드
      const MIN_SAMPLES = 1;
      const MIN_COVERAGE = 0.001;

      if (recentCount < MIN_SAMPLES || aggr.coveragePct < MIN_COVERAGE) {
        const msg =
          `데이터가 충분하지 않습니다. (need≥${MIN_SAMPLES}, got=${recentCount}; ` +
          `coverage≥${(MIN_COVERAGE * 100).toFixed(0)}%, got=${(aggr.coveragePct * 100).toFixed(0)}%)`;

        // 데모 요구사항: GPT가 정하기 전까지 status를 확정하지 않음 → 'loading' 유지
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
      setStatus(res.status);       // ✅ GPT 응답으로 확정
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

      // 에러 시에도 상태는 확정하지 않음(= 계속 'loading')
      setSummary([]);
      setGuidelines([]);
      setDisclaimer("");
      setReport(
        `Falling back to local report (no AI).\n` +
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

  /**
   * Test Data Set for Demoday
   */
  const injectScenario = useCallback(async (mode: "good" | "fine" | "bad-fever" | "bad-heat") => {
    // 1) 최근 버퍼 상황
    const now = Date.now();
    const start = now - 10 * 60_000; // 최근 10분 구간에 1Hz로 채움
    const N = 60 * 10;               // 10분 * 60 = 600 샘플
    const dt = 1000;                 // 1Hz

    // 2) 타겟 프로파일
    let target = { hr: 72, body: 36.7, amb: 24, hum: 40, mlxObj: 36.7, mlxAmb: 24 };
    if (mode === "fine")       target = { hr: 95,  body: 37.3, amb: 26, hum: 45, mlxObj: 37.3, mlxAmb: 26 };
    else if (mode === "bad-fever") target = { hr: 120, body: 38.2, amb: 25, hum: 45, mlxObj: 38.2, mlxAmb: 25 };
    else if (mode === "bad-heat")  target = { hr: 110, body: 37.4, amb: 32, hum: 75, mlxObj: 37.4, mlxAmb: 32 };

    // 3) 시작값: 현재 aggr를 베이스로
    const startVals = {
      hr: Number.isFinite(aggr.hrMean as number) ? (aggr.hrMean as number) : Math.max(50, target.hr - 10),
      body: Number.isFinite(aggr.bodyMean as number) ? (aggr.bodyMean as number) : Math.max(36.0, target.body - 0.3),
      amb: Number.isFinite(aggr.ambMean as number) ? (aggr.ambMean as number) : Math.max(18, target.amb - 2),
      hum: Number.isFinite(aggr.humidityMean as number) ? (aggr.humidityMean as number) : Math.max(35, target.hum - 5),
      mlxObj: Number.isFinite(aggr.mlxObjMean as number) ? (aggr.mlxObjMean as number) : Math.max(36.0, target.mlxObj - 0.3),
      mlxAmb: Number.isFinite(aggr.mlxAmbMean as number) ? (aggr.mlxAmbMean as number) : Math.max(18, target.mlxAmb - 2),
    };

    // 4) 선형 보간으로 부드럽게 이동
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    for (let i = 0; i < N; i++) {
      const t = (i + 1) / N; // 0→1
      const ts = start + i * dt;

      const hr = lerp(startVals.hr, target.hr, t);
      const body = lerp(startVals.body, target.body, t);
      const amb = lerp(startVals.amb, target.amb, t);
      const hum = lerp(startVals.hum, target.hum, t);
      const mlxObjectC = lerp(startVals.mlxObj, target.mlxObj, t);
      const mlxAmbientC = lerp(startVals.mlxAmb, target.mlxAmb, t);

      addReading({
        heartRate: hr,
        bodyTempC: body,
        ambientTempC: amb,
        humidity: hum,
        mlxObjectC,
        mlxAmbientC,
        timestamp: ts,
      } as any);
    }

    // 5) 주입 후 LLM 재실행
    await runLLM();
  }, [aggr, runLLM]);

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
