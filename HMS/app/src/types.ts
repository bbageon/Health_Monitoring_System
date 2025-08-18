export type BaseScreenProps = {
  title?: string;
};

export type SensorReading = {
  heartRate: number;      // bpm
  bodyTempC: number;      // °C
  ambientTempC: number;   // °C
  timestamp: number;      // ms
};

export type SensorStatus = "disconnected" | "connecting" | "connected" | "error";
