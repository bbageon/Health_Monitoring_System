// src/main/MainContainer.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import MainPresenter from "./MainPresenter";
import type { MainContainerProps } from "./types";
import type { SensorReading, SensorStatus } from "../types";

const DEFAULT_WS_URL = "ws://172.20.10.14/ws";

export default function MainContainer({ title = "Main", connectionUrl }: MainContainerProps) {
  const [status, setStatus] = useState<SensorStatus>("disconnected");
  const [reading, setReading] = useState<SensorReading | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false); // 👈 수동 끊김 플래그

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
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }, []);

  // WebSocket 연결
  const connectWs = useCallback(() => {
    const url = connectionUrl || DEFAULT_WS_URL;

    // 이미 연결/연결중이면 중복 연결 방지
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    manualDisconnectRef.current = false; // 수동 끊김 아닌 상태로 리셋
    teardown();
    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      reconnectAttemptsRef.current = 0;

      clearHeartbeat();
      heartbeatRef.current = setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch {}
      }, 20000);
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(String(evt.data));
        // ESP32가 null을 보낼 수도 있으니 number 체크
        if (
          typeof data?.heartRate === "number" &&
          typeof data?.bodyTempC === "number" &&
          typeof data?.ambientTempC === "number"
        ) {
          const payload: SensorReading = {
            heartRate: Math.round(data.heartRate),
            bodyTempC: Number(data.bodyTempC),
            ambientTempC: Number(data.ambientTempC),
            timestamp: Number(data.ts ?? Date.now()),
          };
          setReading(payload);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("disconnected");
      clearHeartbeat();

      // 수동 종료가 아니면 지수 백오프로 재연결
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

  const onConnect = useCallback(() => {
    connectWs();
  }, [connectWs]);

  const onDisconnect = useCallback(() => {
    manualDisconnectRef.current = true; // 👈 수동 끊김 표시
    reconnectAttemptsRef.current = 0;
    clearReconnectTimer();
    teardown();
    setStatus("disconnected");
  }, [teardown]);

  useEffect(() => {
    return () => {
      manualDisconnectRef.current = true;
      teardown();
    };
  }, [teardown]);

  return (
    <MainPresenter
      title={title}
      status={status}
      reading={reading}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
    />
  );
}
