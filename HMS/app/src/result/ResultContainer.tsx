// app/src/result/ResultContainer.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResultPresenter from "./ResultPresenter";
import { getLastHourReadings } from "../store/readingStore";
import OpenAI from "openai";

export type Aggregates = {
  hrMean: number | null;
  bodyMean: number | null;
  ambMean: number | null;
  humidityMean: number | null;
  coveragePct: number;
};

const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

function avg(nums: number[]) {
  const arr = nums.filter((n) => Number.isFinite(n));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function classifyLocal(a: Aggregates): "bad" | "fine" | "good" {
  const hr = a.hrMean ?? NaN;
  const bt = a.bodyMean ?? NaN;
  if ((Number.isFinite(hr) && hr > 100) || (Number.isFinite(bt) && bt > 37.8)) return "bad";
  if (Number.isFinite(hr) && hr >= 55 && hr <= 85 && Number.isFinite(bt) && bt >= 36.0 && bt <= 37.2) return "good";
  return "fine";
}

function normalizeStatus(s: any): "bad" | "fine" | "good" {
  const v = String(s ?? "").toLowerCase();
  if (v === "good") return "good";
  if (v === "bad") return "bad";
  return "fine";
}

export default function ResultContainer() {
  // 최근 1시간 집계
  const { aggr, recentCount } = useMemo(() => {
    const now = Date.now();
    const from = now - 3600_000;
    const rows = getLastHourReadings(from, now);

    const hrMean = avg(rows.map((r) => r.heartRate));
    const bodyMean = avg(rows.map((r) => r.bodyTempC));
    const ambMean = avg(rows.map((r) => r.ambientTempC));
    const humidityMean = avg(rows.map((r) => (typeof r.humidity === "number" ? r.humidity : NaN)));
    const coveragePct = Math.min(rows.length / 3600, 1);

    return { aggr: { hrMean, bodyMean, ambMean, humidityMean, coveragePct }, recentCount: rows.length };
  }, []);

  const [status, setStatus] = useState<"bad" | "fine" | "good">(normalizeStatus(classifyLocal(aggr)));
  // 새로운 상태: summary/guidelines/disclaimer를 분리 저장
  const [summary, setSummary] = useState<string[]>([]);
  const [guidelines, setGuidelines] = useState<string[]>([]);
  const [disclaimer, setDisclaimer] = useState<string>("");

  // fallback/오류 메시지용 기존 report
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Hot Reload/중복호출 방지
  const hasRunRef = useRef(false);
  const inFlightRef = useRef(false);

  const runLLM = useCallback(async () => {
    console.log("[Container] runLLM called");

    if (inFlightRef.current) {
      console.log("[Container] runLLM ignored: already in flight");
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setLastError(null);

    try {
      console.log("[Container] guard check -> recentCount:", recentCount, "coverage:", aggr.coveragePct);
      console.log("[Container] aggregates:", aggr);

      // (완화된) 데이터 가드
      const MIN_SAMPLES = 10;
      const MIN_COVERAGE = 0.01;

      if (recentCount < MIN_SAMPLES || aggr.coveragePct < MIN_COVERAGE) {
        const msg =
          `데이터가 충분하지 않습니다. (need≥${MIN_SAMPLES}, got=${recentCount}; ` +
          `coverage≥${(MIN_COVERAGE * 100).toFixed(0)}%, got=${(aggr.coveragePct * 100).toFixed(0)}%)`;

        const localStatus = normalizeStatus(classifyLocal(aggr));
        setStatus(localStatus);

        // "현재 상태 안내"에는 요약 2줄을 넣음
        setSummary([
          "Not enough data to generate a full AI summary.",
          `HR ${aggr.hrMean?.toFixed(0) ?? "--"} bpm • Body ${aggr.bodyMean?.toFixed(2) ?? "--"} °C • Amb ${aggr.ambMean?.toFixed(2) ?? "--"} °C • Hum ${aggr.humidityMean?.toFixed(1) ?? "--"} %`,
        ]);
        // 가이드라인은 비워두고, Presenter가 fallback으로 report/indicator를 사용
        setGuidelines([]);
        setDisclaimer("");

        setReport(
          `${msg}\n` +
          `• HR avg: ${aggr.hrMean?.toFixed(0) ?? "--"} bpm\n` +
          `• Body: ${aggr.bodyMean?.toFixed(2) ?? "--"} °C\n` +
          `• Amb/Hum: ${aggr.ambMean?.toFixed(2) ?? "--"} °C / ${aggr.humidityMean?.toFixed(1) ?? "--"} %\n` +
          `• Coverage: ${(aggr.coveragePct * 100).toFixed(0)}%`
        );
        return;
      }

      if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
        const msg = "OpenAI API 키가 설정되지 않았습니다 (.env의 EXPO_PUBLIC_OPENAI_API_KEY).";
        setLastError(msg);
        setStatus(normalizeStatus(classifyLocal(aggr)));
        // 요약/가이드라인 비워두고 fallback report 사용
        setSummary([]);
        setGuidelines([]);
        setDisclaimer("");
        setReport(msg);
        return;
      }

      console.log("[Container] calling OpenAI…");
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
`You are a health data coach. Reply with ONLY the following JSON (no prose):

{
  "status": "bad|fine|good",
  "summary": ["two short lines summarizing current state", "second line"],
  "guidelines": ["next action 1", "next action 2", "next action 3", "next action 4", "next action 5"],
  "disclaimer": "one line, not medical advice"
}

Rules:
- English only
- Choose status carefully based on vitals (HR, body temp, ambient temp, humidity)
- Give practical, safe self-care guidance (no diagnosis or treatment orders)
- Exactly 2 summary lines and exactly 5 guideline lines
- Output JSON only`
          },
          {
            role: "user",
            content:
`Aggregated values (last 1h):
HR=${aggr.hrMean}, Body=${aggr.bodyMean}, Amb=${aggr.ambMean}, Hum=${aggr.humidityMean}`
          }
        ],
        temperature: 0.2,
      });

      const txt = completion.choices?.[0]?.message?.content ?? "{}";
      console.log("[Container] OpenAI response:", txt);

      try {
        const match = txt.match(/\{[\s\S]*\}$/);
        const jsonText = match ? match[0] : txt;
        const obj = JSON.parse(jsonText);

        const statusFromLLM = normalizeStatus(obj?.status);
        setStatus(statusFromLLM);

        const summaryLines: string[] = Array.isArray(obj?.summary) ? obj.summary.slice(0, 2) : [];
        const guidelineLines: string[] = Array.isArray(obj?.guidelines) ? obj.guidelines.slice(0, 5) : [];
        const disclaimerLine: string = obj?.disclaimer ?? "";

        setSummary(summaryLines);
        setGuidelines(guidelineLines);
        setDisclaimer(disclaimerLine);

        // LLM 성공 시 report는 비움(오류/파싱 실패 fallback 용)
        setReport("");
      } catch (err) {
        console.warn("[Container] JSON parse failed, fallback:", err);
        const localStatus = normalizeStatus(classifyLocal(aggr));
        setStatus(localStatus);

        setSummary([]);
        setGuidelines([]);
        setDisclaimer("");
        setReport("⚠️ Failed to parse JSON from model.\n" + txt);
      }
    } catch (e: any) {
      console.error("[Container] runLLM error:", e);
      const msg =
        e?.status === 429
          ? "요청이 너무 많습니다(429). 잠시 후 다시 시도해주세요."
          : (e?.message || "알 수 없는 오류가 발생했습니다.");

      setLastError(msg);
      setStatus(normalizeStatus(classifyLocal(aggr)));
      setSummary([]);
      setGuidelines([]);
      setDisclaimer("");
      setReport(
        `로컬 분석 결과로 대체합니다.\n` +
        `• HR avg: ${aggr.hrMean?.toFixed(0) ?? "--"} bpm\n` +
        `• Body: ${aggr.bodyMean?.toFixed(2) ?? "--"} °C\n` +
        `• Amb/Hum: ${aggr.ambMean?.toFixed(2) ?? "--"} °C / ${aggr.humidityMean?.toFixed(1) ?? "--"} %`
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      console.log("[Container] runLLM finished");
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
      report={report}        // fallback
      loading={loading}
      lastError={lastError}
      onGenerate={runLLM}
    />
  );
}
