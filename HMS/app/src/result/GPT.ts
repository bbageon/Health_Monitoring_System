import OpenAI from "openai";

// === Types === //
export type LlmStatus = "bad" | "fine" | "good";

export type Aggregates = {
  hrMean: number | null;
  bodyMean: number | null;
  ambMean: number | null;
  humidityMean: number | null;
  mlxObjMean: number | null;
  mlxAmbMean: number | null;
  coveragePct: number;
};

export type HealthSummary = {
  status: LlmStatus;
  summary: string[];    // expect length 2
  guidelines: string[]; // expect length 5
  disclaimer: string;
};

// === Client (test/prototype only) === //
const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  // 브라우저 직접 호출은 테스트 용으로만!
  dangerouslyAllowBrowser: true,
});

// === Helpers === //
export function normalizeStatus(s: unknown): LlmStatus {
  const v = String(s ?? "").toLowerCase();
  if (v === "good") return "good";
  if (v === "bad") return "bad";
  return "fine";
}

export function makeSystemPrompt() {
  return `You are a health data coach. Reply with ONLY the following JSON (no prose):

{
  "status": "bad|fine|good",
  "summary": ["two short lines summarizing current state", "second line"],
  "guidelines": ["next action 1", "next action 2", "next action 3", "next action 4", "next action 5"],
  "disclaimer": "one line, not medical advice"
}

Rules:
- English only
- Choose status carefully based on vitals (HR, body temp, ambient temp, humidity)
- Exactly 2 summary lines and exactly 5 guideline lines
- Output JSON only`;
}

export function makeUserPrompt(a: Aggregates) {
  return `Aggregated values (last 1h):
HR=${a.hrMean}, Body=${a.bodyMean}, Amb=${a.ambMean}, Hum=${a.humidityMean}, MLX_Obj=${a.mlxObjMean}, MLX_Amb=${a.mlxAmbMean}`;
}

/** 모델 응답 텍스트에서 JSON 본문만 추출 */
export function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}$/);
  return match ? match[0] : text;
}

/** 스키마 느슨 검증 + 보정 */
export function coerceHealthSummary(obj: any): HealthSummary {
  const status = normalizeStatus(obj?.status);
  const summary = Array.isArray(obj?.summary) ? obj.summary.slice(0, 2) : [];
  const guidelines = Array.isArray(obj?.guidelines) ? obj.guidelines.slice(0, 5) : [];
  const disclaimer = typeof obj?.disclaimer === "string" ? obj.disclaimer : "";
  return { status, summary, guidelines, disclaimer };
}

/** 타임아웃 래퍼 (필요시 조절) */
function withTimeout<T>(p: Promise<T>, ms: number, msg = "Request timed out"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** 공개 함수: 집계값을 받아 모델 요약을 돌려줍니다 */
export async function fetchHealthSummary(aggr: Aggregates): Promise<HealthSummary> {
  if (!process.env.EXPO_PUBLIC_OPENAI_API_KEY) {
    throw new Error("OpenAI API key missing (.env EXPO_PUBLIC_OPENAI_API_KEY)");
  }

  const completion = await withTimeout(
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: makeSystemPrompt() },
        { role: "user", content: makeUserPrompt(aggr) },
      ],
    }),
    10000 // 10s timeout
  );

  const txt = completion.choices?.[0]?.message?.content ?? "{}";
  const jsonText = extractJson(txt);
  const parsed = JSON.parse(jsonText);
  return coerceHealthSummary(parsed);
}
