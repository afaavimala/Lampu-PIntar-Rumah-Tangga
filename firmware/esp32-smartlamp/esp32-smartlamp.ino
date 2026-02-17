#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <mbedtls/md.h>

/*
 * =========================
 * CONFIGURATION
 * =========================
 */
static const char* WIFI_SSID = "REPLACE_WIFI_SSID";
static const char* WIFI_PASSWORD = "REPLACE_WIFI_PASSWORD";

static const char* MQTT_HOST = "REPLACE_MQTT_HOST";
static const uint16_t MQTT_PORT = 8883;
static const char* MQTT_USERNAME = "REPLACE_MQTT_USERNAME";
static const char* MQTT_PASSWORD = "REPLACE_MQTT_PASSWORD";

static const char* DEVICE_ID = "lampu-ruang-tamu";
static const char* HMAC_SECRET = "REPLACE_DEVICE_HMAC_SECRET";

static const int RELAY_PIN = 2;
static const int STATUS_LED_PIN = 4;

/*
 * =========================
 * GLOBALS
 * =========================
 */
WiFiClientSecure tlsClient;
PubSubClient mqttClient(tlsClient);

String topicCmd;
String topicStatus;
String topicLwt;

bool relayOn = false;
unsigned long lastReconnectAttempt = 0;
const unsigned long reconnectIntervalMs = 3000;

struct SeenNonce {
  String nonce;
  uint32_t expiresAt;
};

static const size_t NONCE_CACHE_SIZE = 32;
SeenNonce nonceCache[NONCE_CACHE_SIZE];
size_t nonceInsertIndex = 0;

/*
 * =========================
 * UTIL
 * =========================
 */
String toHex(const uint8_t* input, size_t len) {
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += hex[(input[i] >> 4) & 0x0F];
    out += hex[input[i] & 0x0F];
  }
  return out;
}

String hmacSha256Hex(const String& key, const String& payload) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);

  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, reinterpret_cast<const unsigned char*>(key.c_str()), key.length());
  mbedtls_md_hmac_update(&ctx, reinterpret_cast<const unsigned char*>(payload.c_str()), payload.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);

  return toHex(out, sizeof(out));
}

uint32_t nowEpochMs() {
  time_t nowSec = time(nullptr);
  if (nowSec <= 0) {
    return 0;
  }
  return static_cast<uint32_t>(nowSec) * 1000UL;
}

bool isNonceReplay(const String& nonce, uint32_t expiresAt) {
  const uint32_t nowMs = nowEpochMs();

  for (size_t i = 0; i < NONCE_CACHE_SIZE; i++) {
    if (nonceCache[i].expiresAt != 0 && nonceCache[i].expiresAt < nowMs) {
      nonceCache[i].nonce = "";
      nonceCache[i].expiresAt = 0;
    }
  }

  for (size_t i = 0; i < NONCE_CACHE_SIZE; i++) {
    if (nonceCache[i].expiresAt != 0 && nonceCache[i].nonce == nonce) {
      return true;
    }
  }

  nonceCache[nonceInsertIndex].nonce = nonce;
  nonceCache[nonceInsertIndex].expiresAt = expiresAt;
  nonceInsertIndex = (nonceInsertIndex + 1) % NONCE_CACHE_SIZE;
  return false;
}

void setRelayState(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
}

void publishStatus(const char* reason, const char* requestId) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["power"] = relayOn ? "ON" : "OFF";
  doc["ts"] = nowEpochMs();
  doc["reason"] = reason;
  if (requestId != nullptr && strlen(requestId) > 0) {
    doc["requestId"] = requestId;
  }

  char buffer[256];
  const size_t n = serializeJson(doc, buffer, sizeof(buffer));
  mqttClient.publish(topicStatus.c_str(), buffer, n, true);
}

bool verifyCommandEnvelope(const String& payload, const JsonDocument& doc) {
  const char* deviceId = doc["deviceId"] | "";
  const char* action = doc["action"] | "";
  const char* requestId = doc["requestId"] | "";
  const uint32_t issuedAt = doc["issuedAt"] | 0;
  const uint32_t expiresAt = doc["expiresAt"] | 0;
  const char* nonce = doc["nonce"] | "";
  const char* sig = doc["sig"] | "";

  if (strlen(deviceId) == 0 || strlen(action) == 0 || strlen(requestId) == 0 || strlen(nonce) == 0 || strlen(sig) == 0) {
    Serial.println("[cmd] reject: missing required fields");
    return false;
  }

  if (String(deviceId) != String(DEVICE_ID)) {
    Serial.println("[cmd] reject: wrong deviceId");
    return false;
  }

  const uint32_t nowMs = nowEpochMs();
  if (nowMs == 0) {
    Serial.println("[cmd] reject: clock not synced");
    return false;
  }

  if (expiresAt <= nowMs) {
    Serial.println("[cmd] reject: expired command");
    return false;
  }

  if (isNonceReplay(String(nonce), expiresAt)) {
    Serial.println("[cmd] reject: nonce replay");
    return false;
  }

  String canonical = String(deviceId) + "|" + String(action) + "|" + String(requestId) + "|" +
                     String(issuedAt) + "|" + String(expiresAt) + "|" + String(nonce);

  String expectedSig = hmacSha256Hex(String(HMAC_SECRET), canonical);
  if (expectedSig != String(sig)) {
    Serial.println("[cmd] reject: bad signature");
    return false;
  }

  return true;
}

/*
 * =========================
 * MQTT HANDLERS
 * =========================
 */
void handleCommand(const String& payload) {
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.println("[cmd] reject: invalid json");
    return;
  }

  if (!verifyCommandEnvelope(payload, doc)) {
    return;
  }

  const char* action = doc["action"] | "";
  const char* requestId = doc["requestId"] | "";

  if (String(action) == "ON") {
    setRelayState(true);
    publishStatus("command", requestId);
    Serial.println("[cmd] applied: ON");
    return;
  }

  if (String(action) == "OFF") {
    setRelayState(false);
    publishStatus("command", requestId);
    Serial.println("[cmd] applied: OFF");
    return;
  }

  Serial.println("[cmd] reject: unknown action");
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String topicStr(topic);
  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(payload[i]);
  }

  if (topicStr == topicCmd) {
    handleCommand(message);
  }
}

bool mqttConnect() {
  if (mqttClient.connected()) return true;

  String clientId = String("esp32-") + DEVICE_ID + "-" + String(random(0xFFFF), HEX);
  bool ok = mqttClient.connect(
    clientId.c_str(),
    MQTT_USERNAME,
    MQTT_PASSWORD,
    topicLwt.c_str(),
    1,
    true,
    "OFFLINE"
  );

  if (!ok) {
    Serial.printf("[mqtt] connect fail state=%d\n", mqttClient.state());
    return false;
  }

  mqttClient.subscribe(topicCmd.c_str(), 1);
  mqttClient.publish(topicLwt.c_str(), "ONLINE", true);
  publishStatus("boot", nullptr);
  Serial.println("[mqtt] connected + subscribed");
  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.printf("[wifi] connected ip=%s\n", WiFi.localIP().toString().c_str());
}

void syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("[ntp] syncing");
  for (int i = 0; i < 20; i++) {
    if (time(nullptr) > 100000) {
      Serial.println(" ok");
      return;
    }
    delay(500);
    Serial.print(".");
  }
  Serial.println(" timeout");
}

/*
 * =========================
 * ARDUINO
 * =========================
 */
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  setRelayState(false);

  topicCmd = String("home/") + DEVICE_ID + "/cmd";
  topicStatus = String("home/") + DEVICE_ID + "/status";
  topicLwt = String("home/") + DEVICE_ID + "/lwt";

  connectWifi();
  syncClock();

  // Untuk bootstrap awal. Untuk production, ganti dengan setCACert().
  tlsClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt >= reconnectIntervalMs) {
      lastReconnectAttempt = now;
      mqttConnect();
    }
  } else {
    mqttClient.loop();
  }
}
