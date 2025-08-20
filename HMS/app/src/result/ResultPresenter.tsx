// app/src/result/ResultPresenter.tsx
import React from "react";
import { SafeAreaView, View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import type { Aggregates } from "./ResultContainer";
import { ResultStyles } from "./styles";

function emojiFor(status: "bad" | "fine" | "good") {
  return status === "good" ? "🙂" : status === "fine" ? "😐" : "😟";
}
function statusKo(status: "bad" | "fine" | "good") {
  return status === "good" ? "Good" : status === "fine" ? "Fine" : "Bad";
}

type Props = {
  aggr: Aggregates;
  recentCount: number;
  status: "bad" | "fine" | "good";
  summary: string[];        // 현재 상태 안내(요약 2줄)
  guidelines: string[];     // AI Report 가이드라인(5줄)
  disclaimer: string;       // 비의료 자문 고지 1줄
  report: string;           // fallback 텍스트
  loading?: boolean;
  lastError?: string | null;
  onGenerate?: () => void;
};

export default function Presenter({
  aggr, recentCount, status, summary, guidelines, disclaimer, report, loading, lastError, onGenerate,
}: Props) {
  // LLM summary가 없을 때 사용할 로컬 안내문 (fallback)
  const guidance =
    status === "good"
      ? "현재 상태가 안정적이에요. 가벼운 스트레칭과 수분 섭취를 유지하세요."
      : status === "fine"
      ? "무난하지만 변동이 있어요. 휴식/수분 섭취를 챙기고 과한 활동을 피하세요."
      : "과부하 신호가 보입니다. 강도 높은 활동은 피하고, 휴식과 수분 섭취, 통풍을 권장합니다.";

  return (
    <SafeAreaView style={ResultStyles.safe}>
      <ScrollView contentContainerStyle={ResultStyles.container}>
        <View style={ResultStyles.emojiWrap}>
          <Text style={ResultStyles.emoji}>{emojiFor(status)}</Text>
          <Text style={ResultStyles.statusText}>{statusKo(status)}</Text>
        </View>

        <View style={ResultStyles.cards}>
          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Heart Rate</Text>
            <Text style={ResultStyles.value}>
              {aggr.hrMean == null ? "--" : `${aggr.hrMean.toFixed(0)} bpm`}
            </Text>
          </View>
          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Body Temp</Text>
            <Text style={ResultStyles.value}>
              {aggr.bodyMean == null ? "--" : `${aggr.bodyMean.toFixed(2)} °C`}
            </Text>
          </View>
          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Ambient Temp</Text>
            <Text style={ResultStyles.value}>
              {aggr.ambMean == null ? "--" : `${aggr.ambMean.toFixed(2)} °C`}
            </Text>
          </View>
          <View style={ResultStyles.card}>
            <Text style={ResultStyles.label}>Avg Humidity</Text>
            <Text style={ResultStyles.value}>
              {aggr.humidityMean == null ? "--" : `${aggr.humidityMean.toFixed(1)} %`}
            </Text>
          </View>
        </View>

        {/* 현재 상태 안내: 요약 2줄 (없으면 guidance fallback) */}
        <View style={ResultStyles.block}>
          <Text style={ResultStyles.blockTitle}>Currently Condition</Text>
          {summary && summary.length > 0 ? (
            summary.map((line, idx) => (
              <Text key={idx} style={ResultStyles.blockText}>{line}</Text>
            ))
          ) : (
            <Text style={ResultStyles.blockText}>{guidance}</Text>
          )}
        </View>

        {/* AI Report: 가이드라인 5개 + 디스클레이머 (없으면 fallback report/로딩표시) */}
        <View style={ResultStyles.block}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={ResultStyles.blockTitle}>AI Guide Line</Text>
            <Pressable
              onPress={onGenerate}
              disabled={loading}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#1F2A54", borderRadius: 10 }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>
                {loading ? "Generating..." : "Generate Report"}
              </Text>
            </Pressable>
          </View>

          {lastError ? (
            <Text style={[ResultStyles.blockText, { color: "#b91c1c" }]}>{lastError}</Text>
          ) : null}

          {guidelines && guidelines.length > 0 ? (
            <>
              {guidelines.map((g, idx) => (
                <Text key={idx} style={ResultStyles.blockText}>• {g}</Text>
              ))}
              {disclaimer ? (
                <Text style={[ResultStyles.blockText, { fontStyle: "italic", marginTop: 4 }]}>
                  {disclaimer}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              {!report ? <ActivityIndicator /> : <Text style={ResultStyles.blockText}>{report}</Text>}
            </>
          )}

          <Text style={ResultStyles.meta}>
            Window: last 1h • samples: {recentCount} • coverage: {(aggr.coveragePct * 100).toFixed(0)}%
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
