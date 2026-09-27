/**
 * esp32_sensor.ino — BlockFL IoT Node
 * ESP32 + BME280 (nhiệt độ, độ ẩm) + MQ135 (CO2 analog)
 * Gửi dữ liệu lên MQTT Broker mỗi 5 giây
 *
 * Thư viện cần cài:
 *   - PubSubClient (Nick O'Leary)
 *   - Adafruit BME280 Library
 *   - ArduinoJson
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// ── Cấu hình WiFi ─────────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ── Cấu hình MQTT ─────────────────────────────────────────────────────────
const char* MQTT_BROKER = "192.168.1.100";  // IP Raspberry Pi
const int   MQTT_PORT   = 1883;
const char* MQTT_TOPIC  = "blockfl/sensors";
const char* NODE_ID     = "esp32_node_01";

// ── Pins ──────────────────────────────────────────────────────────────────
#define MQ135_PIN 34   // ADC pin cho MQ135

// ── Đối tượng ─────────────────────────────────────────────────────────────
Adafruit_BME280 bme;
WiFiClient      wifiClient;
PubSubClient    mqttClient(wifiClient);

unsigned long lastPublish = 0;
const long    INTERVAL    = 5000;  // ms

// ─────────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Wire.begin();

  // Khởi tạo BME280
  if (!bme.begin(0x76)) {
    Serial.println("[ERR] BME280 không tìm thấy!");
    while (1);
  }
  Serial.println("[OK] BME280 sẵn sàng");

  // Kết nối WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Kết nối WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.printf("\n[OK] WiFi: %s\n", WiFi.localIP().toString().c_str());

  // Cấu hình MQTT
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
}

// ─────────────────────────────────────────────────────────────────────────
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("MQTT kết nối...");
    if (mqttClient.connect(NODE_ID)) {
      Serial.println("OK");
    } else {
      Serial.printf(" thất bại (rc=%d), thử lại 3s\n", mqttClient.state());
      delay(3000);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
void loop() {
  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();

  unsigned long now = millis();
  if (now - lastPublish >= INTERVAL) {
    lastPublish = now;

    // Đọc cảm biến
    float temp     = bme.readTemperature();
    float humidity = bme.readHumidity();
    float pressure = bme.readPressure() / 100.0F;

    // MQ135: đọc ADC thô (0–4095), quy đổi đơn giản
    int   mq135Raw = analogRead(MQ135_PIN);
    float co2_ppm  = map(mq135Raw, 0, 4095, 400, 5000);

    // Tạo JSON payload
    StaticJsonDocument<256> doc;
    doc["node_id"]   = NODE_ID;
    doc["timestamp"] = millis() / 1000;
    doc["temp"]      = temp;
    doc["humidity"]  = humidity;
    doc["pressure"]  = pressure;
    doc["co2_ppm"]   = co2_ppm;

    char payload[256];
    serializeJson(doc, payload);

    mqttClient.publish(MQTT_TOPIC, payload);
    Serial.printf("[PUB] %s\n", payload);
  }
}
