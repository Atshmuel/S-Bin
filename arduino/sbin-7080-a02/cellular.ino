#include "globals.h"

// Opens the modem's UART and powers the SIM7080 on unless it already answers
// AT (alreadyOn); false when it does not answer at all.
bool powerOnModem(bool& alreadyOn) {
    pinMode(BOARD_MODEM_DTR_PIN, OUTPUT);
    digitalWrite(BOARD_MODEM_DTR_PIN, LOW);

    SerialModem.begin(115200, SERIAL_8N1, BOARD_MODEM_RXD_PIN, BOARD_MODEM_TXD_PIN);
    delay(100);

    alreadyOn = modem.testAT(1000);
    if (alreadyOn) {
        Serial.println("✅ Modem already responds to AT; skipping PWRKEY pulse.");
        return true;
    }
    Serial.println("Modem is not responding to AT; powering it on.");
    pinMode(BOARD_MODEM_PWR_PIN, OUTPUT);
    digitalWrite(BOARD_MODEM_PWR_PIN, LOW);
    delay(100);
    digitalWrite(BOARD_MODEM_PWR_PIN, HIGH);
    delay(1000);
    digitalWrite(BOARD_MODEM_PWR_PIN, LOW);

    Serial.println("🚀 Booting SIM7080G...");
    const unsigned long startedAt = millis();
    while (millis() - startedAt < 30000UL) {
        if (modem.testAT(500)) {
            return true;
        }
        delay(500);
    }
    Serial.println("❌ No AT response after power-on. Check modem power, PWRKEY=41, and UART1 (RX=4, TX=5).");
    return false;
}

// Asks the modem whether a SIM card is in, without TinyGSM's init (which
// fails without one). Right after power-on the card can read "not ready" for
// a few seconds, so only a clear answer counts; anything else is SIM_UNKNOWN.
SimCardState probeSimCard() {
    bool alreadyOn = false;
    if (!powerOnModem(alreadyOn)) {
        return SIM_UNKNOWN;
    }
    modem.sendAT("+CMEE=2");  // errors as text: "SIM not inserted"
    modem.waitResponse();
    const unsigned long startedAt = millis();
    while (millis() - startedAt < 15000UL) {
        modem.sendAT("+CPIN?");
        const int8_t answer = modem.waitResponse(3000L, "+CPIN: READY", "+CPIN: SIM P", "SIM not inserted");
        if (answer == 1 || answer == 2) {
            modem.waitResponse();
            Serial.println("📶 A SIM card is in.");
            return SIM_PRESENT;
        }
        if (answer == 3) {
            Serial.println("📴 No SIM card.");
            return SIM_ABSENT;
        }
        delay(1000);
    }
    Serial.println("⚠️ The modem gave no clear answer about the SIM card.");
    return SIM_UNKNOWN;
}

// Turns the modem off (its own power-down, then the rails), for a leaf.
void powerOffModem() {
    if (modem.testAT(500)) {
        modem.poweroff();
    }
    cutModemPower();
}

// The modem answers AT a moment before it can be initialized (on 2026-11-01 one
// init, 1.5 s after the power-on, failed with the SIM ready and the gateway gave
// up its whole slot), so a failed init is tried again a few times first.
namespace {
constexpr uint8_t MODEM_INIT_ATTEMPTS = 3;
constexpr uint32_t MODEM_INIT_RETRY_DELAY_MS = 2000;

bool initModemWithRetries() {
    for (uint8_t attempt = 1; attempt <= MODEM_INIT_ATTEMPTS; attempt++) {
        if (modem.init()) {
            return true;
        }
        if (attempt < MODEM_INIT_ATTEMPTS) {
            Serial.printf("⚠️ Modem init failed (attempt %u of %u); trying again.\n", attempt, MODEM_INIT_ATTEMPTS);
            delay(MODEM_INIT_RETRY_DELAY_MS);
        }
    }
    return false;
}
}

bool initializeModem() {
    bool alreadyOn = false;
    if (!powerOnModem(alreadyOn)) {
        return false;
    }

    if (!initModemWithRetries()) {
        if (!modem.testAT(1000)) {
            Serial.println("❌ Modem Init Failed: no AT response on UART1 (RX=4, TX=5).");
            Serial.println("Check modem power, PWRKEY=41, and UART wiring/pin selection.");
        } else {
            Serial.println("❌ Modem responds to AT, but TinyGSM initialization failed.");
            Serial.print("SIM status: ");
            Serial.println(static_cast<int>(modem.getSimStatus()));
            Serial.println("Check SIM insertion/lock and modem firmware.");
        }
        return false;
    }

    Serial.println("✅ SIM7080G modem initialized.");
    // A modem that stayed on through an ESP32 reset may still have GNSS on from
    // an interrupted refresh; one powered on just now starts with it off.
    if (alreadyOn && !stopGpsAcquisition()) {
        Serial.println("⚠️ Could not make sure GNSS and its antenna power are off.");
    }
    return true;
}

bool maintainCellularConnection() {
    if (!modem.isNetworkConnected()) {
        Serial.println("⚠️ Network connection lost. Reconnecting...");
        if (modem.waitForNetwork(10000L)) {
            Serial.println("🎉 Reconnected to Cellular Network!");
        } else {
            Serial.println("❌ Still searching for network...");
            return false;
        }
    }

    if (!modem.isGprsConnected()) {
        Serial.println("⚠️ GPRS disconnected. Connecting to APN...");
        if (!modem.gprsConnect(apn, "", "")) {
            Serial.println("❌ Failed to connect to the APN.");
            return false;
        }
        Serial.println("🎉 GPRS connected.");
    }

    return modem.isNetworkConnected() && modem.isGprsConnected();
}
