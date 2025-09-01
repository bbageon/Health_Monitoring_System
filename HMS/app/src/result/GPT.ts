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
  summary: string[];    
  guidelines: string[];
  disclaimer: string;
};

// === Client (test/prototype only) === //
const openai = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  // Use this option for test
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
  return `You are a cautious, clinically-informed health data coach. Reply with ONLY the JSON below (no prose, no extra keys):

{
  "status": "bad|fine|good",
  "summary": ["two short, professional lines summarizing current state", "second line with the key driver(s)"],
  "guidelines": ["next action 1", "next action 2", "next action 3", "next action 4", "next action 5"],
  "disclaimer": "one line, not medical advice"
}

Rules:
- English only. Clinical, neutral tone. No emojis. No hedging like "maybe/kind of".
- Use SI units and name metrics explicitly (e.g., "HR 92 bpm", "Body 36.8 °C", "Amb 27 °C", "Hum 40%").
- Base status only on vitals. Use these conservative heuristics:
  * BAD if any of:
    - HR < 40 bpm or > 140 bpm (sustained), OR
    - Body temp ≥ 38.0 °C (fever-range) or ≤ 35.0 °C (hypothermia-range).
  * GOOD if:
    - HR 60–100 bpm AND Body 36.1–37.2 °C AND no conflicting signals.
  * Otherwise, FINE.
- Consider environment modifiers:
  * Heat stress risk if Amb > 30 °C AND Hum > 70% → mention hydration/cooling and reduced exertion.
  * Dry/cold if Amb < 10 °C → mention insulation and warm environment.
- Use aggregate s as the source of truth; do NOT invent missing values. If a value is null/undefined, acknowledge limited evidence.
- Keep "summary" to concise clinical phrasing: line 1 = overall state; line 2 = key metrics driving the decision (with units).
- "guidelines": 5 actionable, safety-first steps tailored to the metrics and environment (e.g., hydration, rest, ventilation/cooling, light activity, re-check in N minutes).
- "disclaimer": one sentence that this is general wellness guidance, not medical advice; seek professional care for concerning symptoms.
- Output JSON only. Exact schema and list lengths (2 summary lines, 5 guidelines).`;
}


export function makeUserPrompt(a: Aggregates) {
  return `Aggregated values (last 1h):
HR=${a.hrMean}, Body=${a.bodyMean}, Amb=${a.ambMean}, Hum=${a.humidityMean}, MLX_Obj=${a.mlxObjMean}, MLX_Amb=${a.mlxAmbMean}`;
}

// JSON extracted by Model output
export function extractJson(text: string) {
  const match = text.match(/\{[\s\S]*\}$/);
  return match ? match[0] : text;
}

// verify schema
export function coerceHealthSummary(obj: any): HealthSummary {
  const status = normalizeStatus(obj?.status);
  const summary = Array.isArray(obj?.summary) ? obj.summary.slice(0, 2) : [];
  const guidelines = Array.isArray(obj?.guidelines) ? obj.guidelines.slice(0, 5) : [];
  const disclaimer = typeof obj?.disclaimer === "string" ? obj.disclaimer : "";
  return { status, summary, guidelines, disclaimer };
}

function withTimeout<T>(p: Promise<T>, ms: number, msg = "Request timed out"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

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
