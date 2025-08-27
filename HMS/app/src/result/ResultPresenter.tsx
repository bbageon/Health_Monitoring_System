import React, { memo, useMemo } from "react";
import { SafeAreaView, View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import type { Aggregates } from "./GPT"; // ⬅️ 분리한 gpt.ts 기준
import { ResultStyles } from "./styles";

type Status = "bad" | "fine" | "good";

const statusEmoji = (s: Status) => (s === "good" ? "🙂" : s === "fine" ? "😐" : "😟");
const statusLabel = (s: Status) => (s === "good" ? "Good" : s === "fine" ? "Fine" : "Bad");

const fmt = {
  int: (v: number | null, suffix = "") =>
    Number.isFinite(v as number) ? `${(v as number).toFixed(0)}${suffix}` : "--",
  f1: (v: number | null, suffix = "") =>
    Number.isFinite(v as number) ? `${(v as number).toFixed(1)}${suffix}` : "--",
  f2: (v: number | null, suffix = "") =>
    Number.isFinite(v as number) ? `${(v as number).toFixed(2)}${suffix}` : "--",
};

type Props = {
  aggr: Aggregates;
  recentCount: number;
  status: Status;
  summary: string[];
  guidelines: string[];
  disclaimer: string;
  report: string;
  loading?: boolean;
  lastError?: string | null;
  onGenerate?: () => void;
};

function Presenter({
  aggr,
  recentCount,
  status,
  summary,
  guidelines,
  disclaimer,
  report,
  loading = false,
  lastError = null,
  onGenerate,
}: Props) {
  // 상태에 따른 안내문 (fallback)
  const guidance = useMemo(() => {
    if (status === "good") return "Stable condition. Keep light stretching and hydration.";
    if (status === "fine") return "Overall okay with some variability. Rest, hydrate, and avoid intense activity.";
    return "Signs of overload. Avoid strenuous activity; rest, hydrate, and ensure ventilation.";
  }, [status]);

  const coveragePctText = useMemo(
    () => `${Math.round((aggr.coveragePct ?? 0) * 100)}%`,
    [aggr.coveragePct]
  );

  return (
    <SafeAreaView style={ResultStyles.safe}>
      <ScrollView contentContainerStyle={ResultStyles.container}>
        {/* Header: Emoji + Status */}
        <View style={ResultStyles.emojiWrap}>
          <Text style={ResultStyles.emoji}>{statusEmoji(status)}</Text>
          <Text style={ResultStyles.statusText}>{statusLabel(status)}</Text>
        </View>

        {/* KPI Cards */}
        <View style={ResultStyles.cards}>
          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Heart Rate</Text>
            <Text style={ResultStyles.value}>{fmt.int(aggr.hrMean, " bpm")}</Text>
          </View>

          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Body Temp (MLX Obj)</Text>
            <Text style={ResultStyles.value}>{fmt.f2(aggr.bodyMean, " °C")}</Text>
          </View>

          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Ambient Temp (DHT)</Text>
            <Text style={ResultStyles.value}>{fmt.f2(aggr.ambMean, " °C")}</Text>
          </View>

          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Humidity</Text>
            <Text style={ResultStyles.value}>{fmt.f1(aggr.humidityMean, " %")}</Text>
          </View>

          {/* Optional MLX90614 means */}
          {Number.isFinite(aggr.mlxObjMean as number) && (
            <View style={ResultStyles.card}>
              <Text style={ResultStyles.label}>MLX Object Temp (avg)</Text>
              <Text style={ResultStyles.value}>{fmt.f2(aggr.mlxObjMean, " °C")}</Text>
            </View>
          )}
          {Number.isFinite(aggr.mlxAmbMean as number) && (
            <View style={ResultStyles.card}>
              <Text style={ResultStyles.label}>MLX Ambient Temp (avg)</Text>
              <Text style={ResultStyles.value}>{fmt.f2(aggr.mlxAmbMean, " °C")}</Text>
            </View>
          )}
        </View>

        {/* Current Condition: summary(2) or guidance fallback */}
        <View style={ResultStyles.block}>
          <Text style={ResultStyles.blockTitle}>Current Condition</Text>
          {summary?.length > 0 ? (
            summary.slice(0, 2).map((line, idx) => (
              <Text key={idx} style={ResultStyles.blockText}>
                {line}
              </Text>
            ))
          ) : (
            <Text style={ResultStyles.blockText}>{guidance}</Text>
          )}
        </View>

        {/* AI Guidelines */}
        <View style={ResultStyles.block}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={ResultStyles.blockTitle}>AI Guidelines</Text>

            <Pressable
              onPress={onGenerate}
              disabled={loading}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: loading ? "#737373" : "#1F2A54",
                borderRadius: 10,
                opacity: loading ? 0.8 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {loading ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {loading ? "Generating..." : "Generate Report"}
              </Text>
            </Pressable>
          </View>

          {lastError ? (
            <Text style={[ResultStyles.blockText, { color: "#b91c1c", marginTop: 6 }]}>{lastError}</Text>
          ) : null}

          {guidelines?.length > 0 ? (
            <>
              {guidelines.slice(0, 5).map((g, idx) => (
                <Text key={idx} style={ResultStyles.blockText}>
                  • {g}
                </Text>
              ))}
              {disclaimer ? (
                <Text style={[ResultStyles.blockText, { fontStyle: "italic", marginTop: 4 }]}>
                  {disclaimer}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {!report ? (
                // 로딩/생성 전이라면 스피너, 실패/대체면 report 표시
                loading ? <ActivityIndicator style={{ marginTop: 8 }} /> : null
              ) : (
                <Text style={ResultStyles.blockText}>{report}</Text>
              )}
            </>
          )}

          <Text style={ResultStyles.meta}>
            Window: last 1h • Samples: {recentCount} • Coverage: {coveragePctText}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default memo(Presenter);
