# Real-Time Vital Signs Monitoring System (ESP32 + React Native)

Affordable, modular, real-time health monitoring with ESP32 sensors, a WebSocket stream, and an AI-assisted mobile app. 

---

## 1) Overview

This project measures heart rate, body temperature, ambient temperature, and humidity, streams them over WebSocket from an ESP32, and visualizes + summarizes the last hour on a React Native app. It targets a gap between bulky hospital monitors and limited, closed-source wearables by offering a portable, low-cost, extensible solution with basic AI guidance. 

**Why now?**  
IoT hardware like the ESP32 enables continuous home-based monitoring; consumer wearables are limited/customization-poor, while hospital systems are costly and non-portable. 

---

## 2) Features

- Live data stream from ESP32 via WebSocket (heartbeat ping + auto-reconnect backoff).
- On-device validation & smoothing: bounds checks, jump & rate-of-change clamps, optional Hampel filter.
- Rolling 1-hour window with aggregate metrics (means & coverage).
- AI health summary (status + 2-line summary + 5 guidelines + disclaimer) from OpenAI.
- Demo scenarios to inject synthetic data for presentations (“Good”, “Fine”, “Bad – Fever/Heat”).
- Clean mobile UI: connection controls, KPI cards, status emoji, guidelines, and last-update metadata.

---

## 3) System Architecture

**High-level architecture**: ESP32 with multiple sensors → mobile app over WebSocket → rule/AI feedback.

**Hardware (typical set):**
- ESP32 dev board  
- PPG (MAX30100 or equivalent) for heart rate (BPM)  
- MLX90614 for non-contact body & ambient temperature  
- DHT11 for ambient temperature & humidity  

**Software:**
- Arduino IDE for ESP32 firmware  
- React Native (Expo) for the mobile app  
- WebSocket transport  
- OpenAI integration for AI summary  

---

## 4) Repository Layout (App)
app/
src/
main/
MainContainer.tsx # WS connect/teardown, message parsing, addReading()
MainPresenter.tsx # Live KPI UI + controls (Connect/Disconnect/Analyze)
result/
ResultContainer.tsx # Aggregation, AI call, demo data injector
ResultPresenter.tsx # Status, KPIs, guidelines, meta, buttons
store/
readingStore.ts # Validations, clamps, ring buffer, queries
GPT.ts # OpenAI client, prompts, schema coercion
types.ts # SensorReading, SensorStatus, etc.

## 5) Getting Started
- Node.js 18+
- Expo CLI
- OpenAI API key (optional)

Install & Run
# 0) Install ESP32 Board
[ESP32 Code](./project.ino)

# 1) Install
cd HMS
npm install

# 2) Set env
export EXPO_PUBLIC_OPENAI_API_KEY=sk-...

# 3) Start app
npm expo start

# 4) Configure WS URL
# pass connectionUrl prop or change DEFAULT_WS_URL
