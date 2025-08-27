// app/src/main/MainContainer.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import MainPresenter from "./MainPresenter";
import type { SensorReading, SensorStatus } from "../types";
import { addReading } from "../store/readingStore";

type Props = {
  title?: string;
  connectionUrl?: string;
  onAnalyze?: () => void;
};

const DEFAULT_WS_URL = "ws://172.20.10.14/ws";

export default function MainContainer({
  title = "Main",
  connectionUrl,
  onAnalyze,
}: Props) {
  const [status, setStatus] = useState<SensorStatus>("disconnected");
  const [reading, setReading] = useState<SensorReading | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // setInterval have different type= [Browser -> number, Node.js -> NodeJS.Timeout]
  const checkWebsocketRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // setTimeout have different type -> number(browser) or NodeJs.Timeout
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);

  const clearHeartbeat = () => {
    if (checkWebsocketRef.current) {
      clearInterval(checkWebsocketRef.current);
      checkWebsocketRef.current = null;
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
      checkWebsocketRef.current = setInterval(() => {
        try { ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch { }
      }, 20000);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(String(evt.data)) || {};
        const now = Date.now();
        const ts = Number.isFinite(data?.ts) && Number(data.ts) > 1e12 ? Number(data.ts) : now;

        const toNum = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

        const hr = toNum(data.heartRate);
        const amb = toNum(data.ambientTempC);             // DHT
        const mlxObj = toNum(data.mlxObjectC);
        const body = toNum(data.bodyTempC) ?? mlxObj;     // bodyTempC 없으면 mlxObjectC 사용
        const hum = toNum(data.humidity);

        if (hr === undefined || body === undefined || amb === undefined) {
          console.warn("skip frame - missing required numbers", { hr, body, amb });
          return;
        }

        const payload: SensorReading = {
          heartRate: hr,
          bodyTempC: body,
          ambientTempC: amb,
          timestamp: ts,
          ...(hum !== undefined ? { humidity: hum } : {}),
        };

        setReading(payload);
        addReading(payload);
      } catch (e) {
        console.warn("ws parse error", e);
      }
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
