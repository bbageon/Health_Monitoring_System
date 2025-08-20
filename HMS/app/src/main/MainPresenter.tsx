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
        <Pressable
          onPress={() => onAnalyze?.()}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Text style={styles.btnText}>Analyze</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        <View style={card.base}>
          <Text style={card.label}>Heart Rate</Text>
          <Text style={card.value}>{reading ? `${reading.heartRate} bpm` : "--"}</Text>
        </View>
        <View style={card.base}>
          <Text style={card.label}>Body Temp</Text>
          <Text style={card.value}>{reading ? `${reading.bodyTempC?.toFixed?.(2)} °C` : "--"}</Text>
        </View>
        <View style={card.base}>
          <Text style={card.label}>Ambient Temp</Text>
          <Text style={card.value}>{reading ? `${reading.ambientTempC?.toFixed?.(2)} °C` : "--"}</Text>
        </View>
        <View style={card.base}>
          <Text style={card.label}>Humidity</Text>
          <Text style={card.value}>{reading?.humidity == null ? "--" : `${reading.humidity.toFixed(1)} %`}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          {reading ? `Updated: ${new Date(reading.timestamp).toLocaleTimeString()}` : "No data yet"}
        </Text>
      </View>
    </SafeAreaView>
  );
}
