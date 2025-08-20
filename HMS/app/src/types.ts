export type BaseScreenProps = {
  title?: string;
};

export type SensorReading = {
  heartRate: number;
  bodyTempC: number;
  ambientTempC: number;
  timestamp: number;
  humidity?: number | null; // ← add this
};


export type SensorStatus = "disconnected" | "connecting" | "connected" | "error";
