import React, { useCallback, useEffect, useRef, useState } from "react";
import MainPresenter from "./MainPresenter";
import type { SensorReading, SensorStatus } from "../types";
import { addReading, getBufferSize } from "../store/readingStore";

type Props = {
  title?: string;
  connectionUrl?: string;
  onAnalyze?: () => void;
};

// 실제 ESP32 IP로 교체
const DEFAULT_WS_URL = "ws://172.20.10.14/ws";

export default function MainContainer({
  title = "Main",
  connectionUrl,
  onAnalyze,
}: Props) {
  const [status, setStatus] = useState<SensorStatus>("disconnected");
  const [reading, setReading] = useState<SensorReading | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);

  const clearHeartbeat = () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  };
  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };
  const teardown = useCallback(() => {
    clearHeartbeat();
    clearReconnectTimer();
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { }
      wsRef.current = null;
    }
  }, []);

  const connectWs = useCallback(() => {
    const url = connectionUrl || DEFAULT_WS_URL;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualDisconnectRef.current = false;
    teardown();
    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttemptsRef.current = 0;
      clearHeartbeat();
      heartbeatRef.current = setInterval(() => {
        try { ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch { }
      }, 20000);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(String(evt.data));

        // ts가 epoch(ms)처럼 1e12 이상이면 그대로 쓰고,
        // 그 외(ESP millis 등)면 수신 시각으로 교체
        const now = Date.now();
        const ts = Number.isFinite(data?.ts) && data.ts > 1e12 ? Number(data.ts) : now;

        const payload: SensorReading = {
          heartRate: typeof data?.heartRate === "number" ? Math.round(data.heartRate) : (null as any),
          bodyTempC: typeof data?.bodyTempC === "number" ? Number(data.bodyTempC) : (null as any),
          ambientTempC: typeof data?.ambientTempC === "number" ? Number(data.ambientTempC) : (null as any),
          humidity: typeof data?.humidity === "number" ? Number(data.humidity) : null,
          timestamp: ts, // ★ 여기!
        };

        setReading(payload as any);
        addReading(payload as any);
        console.log("accepted, buf size =", getBufferSize());
      } catch { }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      setStatus("disconnected");
      clearHeartbeat();
      if (!manualDisconnectRef.current) {
        const attempt = Math.min(reconnectAttemptsRef.current, 4);
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 15000);
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connectWs();
        }, delayMs);
      }
    };
  }, [connectionUrl, teardown]);

  const onConnect = useCallback(() => { connectWs(); }, [connectWs]);

  const onDisconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    teardown();
    setStatus("disconnected");
  }, [teardown]);

  useEffect(() => {
    return () => { manualDisconnectRef.current = true; teardown(); };
  }, [teardown]);

  return (
    <MainPresenter
      title={title}
      status={status}
      reading={reading}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onAnalyze={onAnalyze}
    />
  );
}