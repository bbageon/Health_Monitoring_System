// app/src/main/MainPresenter.tsx
import React from "react";
import { ActivityIndicator, Pressable, SafeAreaView, Text, View } from "react-native";
import { styles, pill, card } from "./styles";
import type { SensorReading, SensorStatus } from "../types";

type Props = {
  title: string;
  status: SensorStatus;
  reading: SensorReading | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onAnalyze?: () => void;
};

function StatusBadge({ status }: { status: SensorStatus }) {
  const label =
    status === "connected" ? "Connected" :
    status === "connecting" ? "Connecting" :
    status === "error" ? "Error" : "Disconnected";
  const tone =
    status === "connected" ? pill.success :
    status === "connecting" ? pill.info :
    status === "error" ? pill.error : pill.muted;
  return (
    <View style={[pill.base, tone]}>
      <Text style={pill.text}>{label}</Text>
    </View>
  );
}

export default function Presenter({ title, status, reading, onConnect, onDisconnect, onAnalyze }: Props) {
  const isBusy = status === "connecting";
  const isOnline = status === "connected";

  const fmt = (v?: number | null, digits = 2) =>
    v == null || !Number.isFinite(v) ? "--" : v.toFixed(digits);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <StatusBadge status={status} />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={onConnect}
          disabled={isBusy || isOnline}
          style={[styles.btn, (isBusy || isOnline) ? styles.btnDisabled : styles.btnPrimary]}
        >
          {isBusy ? <ActivityIndicator /> : <Text style={styles.btnText}>Connect</Text>}
        </Pressable>
        <Pressable
          onPress={onDisconnect}
          disabled={!isOnline}
          style={[styles.btn, !isOnline ? styles.btnDisabled : styles.btnSecondary]}
        >
          <Text style={styles.btnText}>Disconnect</Text>
        </Pressable>
        <Pressable onPress={() => onAnalyze?.()} style={[styles.btn, styles.btnPrimary]}>
          <Text style={styles.btnText}>Analyze</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        <View style={card.base}>
          <Text style={card.label}>Heart Rate</Text>
          <Text style={card.value}>{reading ? `${reading.heartRate ?? "--"} bpm` : "--"}</Text>
        </View>

        <View style={card.base}>
          <Text style={card.label}>Body Temp (MLX Obj)</Text>
          <Text style={card.value}>{reading ? `${fmt(reading.bodyTempC)} °C` : "--"}</Text>
        </View>

        <View style={card.base}>
          <Text style={card.label}>Ambient Temp (DHT)</Text>
          <Text style={card.value}>{reading ? `${fmt(reading.ambientTempC)} °C` : "--"}</Text>
        </View>

        <View style={card.base}>
          <Text style={card.label}>Humidity</Text>
          <Text style={card.value}>{reading?.humidity == null ? "--" : `${reading.humidity.toFixed(1)} %`}</Text>
        </View>

        {/* MLX90614 개별 필드가 오면 추가로 보여줌 */}
        {reading?.mlxObjectC != null && (
          <View style={card.base}>
            <Text style={card.label}>MLX Object</Text>
            <Text style={card.value}>{`${fmt(reading.mlxObjectC)} °C`}</Text>
          </View>
        )}
        {reading?.mlxAmbientC != null && (
          <View style={card.base}>
            <Text style={card.label}>MLX Ambient</Text>
            <Text style={card.value}>{`${fmt(reading.mlxAmbientC)} °C`}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {reading ? `Updated: ${new Date(reading.timestamp).toLocaleTimeString()}` : "No data yet"}
        </Text>
      </View>
    </SafeAreaView>
  );
}
