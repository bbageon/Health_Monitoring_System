#include "DHT.h"
#include <Wire.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>

// -------- Wi-Fi --------
// You have to change your own network
const char* WIFI_SSID = "김건우의 iPhone";
const char* WIFI_PSK  = "rjsqsc4403";

// -------- Pins --------
#define DHTPIN      32
#define DHTTYPE     DHT11
#define PULSE_PIN   33          // ADC1
#define SDA_PIN     25          // I2C SDA
#define SCL_PIN     26          // I2C SCL

// -------- MLX90614 --------
#define MLX_ADDR    0x5A        // MLX90614
bool mlxReadWord(uint8_t reg, uint16_t &out) {
  Wire.beginTransmission(MLX_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;           // repeated start
  if (Wire.requestFrom((int)MLX_ADDR, 3, (int)true) != 3) return false;
  uint8_t l = Wire.read();
  uint8_t h = Wire.read();
  (void)Wire.read(); // PEC skip
  out = ((uint16_t)h << 8) | l;
  return true;
}
inline float mlxRawToC(uint16_t raw) {
  // Temp(K) = raw * 0.02 ; Temp(C) = K - 273.15
  return raw * 0.02f - 273.15f;
}
bool readMLX90614(float &ambientC, float &objectC) {
  uint16_t ambRaw, objRaw;
  if (!mlxReadWord(0x06, ambRaw)) return false;  // TA (ambient)
  if (!mlxReadWord(0x07, objRaw)) return false;  // TOBJ1 (object)
  ambientC = mlxRawToC(ambRaw);
  objectC  = mlxRawToC(objRaw);
  return true;
}

// -------- Objects --------
DHT dht(DHTPIN, DHTTYPE);

// -------- Shared data (printed & broadcast) --------
volatile float g_bpm = 0.0f;                // PulseSensor BPM (smoothed)
volatile float g_temp = NAN, g_hum = NAN;   // DHT11 ambient & humidity
volatile float g_mlxAmb = NAN, g_mlxObj = NAN; // MLX90614 temps
volatile unsigned long g_lastBeatMs = 0;

// -------- Task handles --------
TaskHandle_t hTaskPulse   = nullptr;
TaskHandle_t hTaskDHT     = nullptr;
TaskHandle_t hTaskPrint   = nullptr;
TaskHandle_t hTaskWsBroad = nullptr;  // WebSocket broadcaster

// -------- WebSocket Server --------
// RN 접속 URL 예: ws://<ESP-IP>/ws 
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ---------- WS events (optional) ----------
void onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    Serial.printf("[WS] Client #%u connected\n", client->id());
  } else if (type == WS_EVT_DISCONNECT) {
    Serial.printf("[WS] Client #%u disconnected\n", client->id());
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
      String msg = String((char*)data).substring(0, len);
      if (msg.indexOf("\"type\":\"ping\"") >= 0) client->text("{\"type\":\"pong\"}");
    }
  }
}

// ===== Pulse Sensor Task (Core 1, high prio) =====
void taskPulse(void* pv) {
  pinMode(PULSE_PIN, INPUT);

  // quick baseline (200 samples)
  long sum = 0;
  for (int i=0;i<200;i++){ sum += analogRead(PULSE_PIN); delay(2); }
  int baseline = sum / 200;
  int lp = baseline;

  const int  LP_ALPHA = 8;       // 1..16 (higher=faster, noisier)
  const int  TH_FLOOR = 30;      // minimum threshold (ADC units)
  int        thresh   = 120;     // dynamic threshold (auto-updated)
  bool       inPeak   = false;

  const unsigned long MIN_IBI_MS = 300;   // >=300 ms (<=200 BPM)
  const unsigned long MAX_IBI_MS = 1500;  // <=40 BPM
  unsigned long lastBeatMs = 0;

  // small moving average (last 4 beats)
  float bpmBuf[4] = {0,0,0,0};
  int   bpmIdx = 0, bpmCount = 0;

  for (;;) {
    int raw = analogRead(PULSE_PIN);

    // low-pass + AC extraction
    lp = lp + ((raw - lp) * LP_ALPHA) / 16;
    int ac = lp - baseline;

    // slow baseline tracking (DC)
    baseline = baseline + (raw - baseline) / 128;

    // adaptive threshold
    int a = abs(ac);
    if (a > thresh) thresh = (3*thresh + a)/4; else thresh = (15*thresh)/16;
    if (thresh < TH_FLOOR) thresh = TH_FLOOR;

    unsigned long now = millis();

    // rising-edge detection with dead-time
    if (!inPeak && ac > thresh && (now - lastBeatMs) > MIN_IBI_MS) {
      inPeak = true;
      unsigned long ibi = now - lastBeatMs;
      if (lastBeatMs > 0 && ibi > MIN_IBI_MS && ibi < MAX_IBI_MS) {
        float bpm = 60000.0f / (float)ibi;
        bpmBuf[bpmIdx] = bpm;
        bpmIdx = (bpmIdx + 1) % 4;
        if (bpmCount < 4) bpmCount++;
        float acc = 0.0f; for (int i=0;i<bpmCount;i++) acc += bpmBuf[i];
        g_bpm = acc / (float)bpmCount;     // smoothed BPM
      }
      lastBeatMs = now;
      g_lastBeatMs = now;
    }

    // end-of-peak on zero crossing
    if (inPeak && ac < 0) inPeak = false;

    // timeout → show 0
    if (now - g_lastBeatMs > 3000) g_bpm = 0.0f;

    vTaskDelay(1); // ~1 kHz task pace
  }
}

// ===== DHT Task (Core 0, low prio) =====
void taskDHT(void* pv) {
  dht.begin();
  for (;;) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (!isnan(t) && !isnan(h)) { g_temp = t; g_hum = h; }

    // MLX90614
    float ambC, objC;
    if (readMLX90614(ambC, objC)) {
      g_mlxAmb = ambC;
      g_mlxObj = objC;
    } else {
      g_mlxAmb = NAN;
      g_mlxObj = NAN;
    }

    vTaskDelay(1000 / portTICK_PERIOD_MS); // every 1 s
  }
}

// ===== Print Task (Core 1, low prio) =====
void taskPrint(void* pv) {
  for (;;) {
    static unsigned long last = 0;
    unsigned long now = millis();
    if (now - last >= 1000) {
      last = now;
      float bpm = g_bpm; float t = g_temp; float h = g_hum;
      float mlxAmb = g_mlxAmb; float mlxObj = g_mlxObj;

      Serial.print("Pulse: ");
      if (bpm > 0.0f) { Serial.print(bpm, 1); Serial.print(" BPM"); }
      else { Serial.print("no beat"); }

      Serial.print(" | DHT11: ");
      if (!isnan(t) && !isnan(h)) {
        Serial.print(t, 1); Serial.print("C, ");
        Serial.print(h, 1); Serial.print("%");
      } else {
        Serial.print("n/a");
      }

      Serial.print(" | MLX Obj: ");
      if (!isnan(mlxObj)) { Serial.print(mlxObj, 2); Serial.print("C"); }
      else { Serial.print("n/a"); }

      Serial.print(" | MLX Amb: ");
      if (!isnan(mlxAmb)) { Serial.print(mlxAmb, 2); Serial.print("C"); }
      else { Serial.print("n/a"); }

      Serial.println();
    }
    vTaskDelay(1);
  }
}

// ===== WebSocket Broadcast Task (Core 0, low prio) =====
// JSON: { heartRate, bodyTempC(=MLX Obj), ambientTempC(=DHT), humidity, ts }
void taskWsBroadcaster(void* pv) {
  char json[280];
  for (;;) {
    float bpm = g_bpm;
    float amb = g_temp;       
    float hum = g_hum;
    float body = g_mlxObj;    

    unsigned long ts = millis();

    auto fOrNull = [](float v, char* buf, size_t sz, int prec=2){
      if (isnan(v)) { snprintf(buf, sz, "null"); }
      else { char fmt[8]; snprintf(fmt, sizeof(fmt), "%%.%df", prec); snprintf(buf, sz, fmt, v); }
    };
    char sBpm[32], sBody[32], sAmb[32], sHum[32];
    fOrNull(bpm, sBpm, sizeof(sBpm), 1);
    fOrNull(body, sBody, sizeof(sBody), 2);
    fOrNull(amb, sAmb, sizeof(sAmb), 2);
    fOrNull(hum, sHum, sizeof(sHum), 1);

    snprintf(json, sizeof(json),
      "{\"heartRate\":%s,\"bodyTempC\":%s,\"ambientTempC\":%s,\"humidity\":%s,\"ts\":%lu}",
      sBpm, sBody, sAmb, sHum, ts);

    ws.textAll(json);
    ws.cleanupClients();
    vTaskDelay(1000 / portTICK_PERIOD_MS); // every 1s
  }
}

// ---------- Wi-Fi ----------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PSK);
  Serial.print("Connecting to Wi-Fi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) { // ~30s timeout
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connect failed (timeout). Continuing without network.");
  }
}

void setup() {
  Serial.begin(115200);

  // I2C init
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000); // 100 kHz (불안정하면 더 낮춰도 됨)
  delay(200);

  // Wi-Fi + WS server
  connectWiFi();
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
    req->send(200, "text/plain", "ESP32 WS OK");
  });
  server.begin();

  // Tasks
  xTaskCreatePinnedToCore(taskPulse, "Pulse", 3072, nullptr, 4, &hTaskPulse, 1);
  xTaskCreatePinnedToCore(taskPrint, "Print", 4096, nullptr, 1, &hTaskPrint, 1);
  xTaskCreatePinnedToCore(taskDHT, "DHT+MLX", 3072, nullptr, 1, &hTaskDHT, 0);
  xTaskCreatePinnedToCore(taskWsBroadcaster, "WS_BROAD", 4096, nullptr, 1, &hTaskWsBroad, 0);
}

void loop() {
  // all work in tasks
}
