import type { BaseScreenProps, SensorReading, SensorStatus } from "../types";

export type MainContainerProps = BaseScreenProps & {
  connectionUrl?: string;
};

export type MainPresenterProps = {
  title: string;
  status: SensorStatus;
  reading: SensorReading | null;
  onConnect: () => void;
  onDisconnect: () => void;
};