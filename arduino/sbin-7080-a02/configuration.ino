#include "globals.h"
#include <esp_mac.h>

namespace {
const IPAddress portalIp(192, 168, 4, 1);
const byte dnsPort = 53;
// The time a location from the setup page is saved with (it has none).
constexpr int64_t SETUP_LOCATION_EPOCH = 1;

// "lat, lng" (as the add-device page's link carries it); false when it is not two
// numbers in range, or is 0, 0 (no location).
bool parseLocation(String text, float& lat, float& lng) {
    text.trim();
    char extra = 0;
    if (sscanf(text.c_str(), "%f , %f %c", &lat, &lng, &extra) != 2) {
        return false;
    }
    return lat >= -90.0f && lat <= 90.0f && lng >= -180.0f && lng <= 180.0f && !(lat == 0.0f && lng == 0.0f);
}

const char setupPortalHtml[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>S-Bin | Device setup</title>
  <script>
    // Before the first paint, so a dark system theme never flashes light.
    document.documentElement.dataset.theme =
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  </script>
  <style>
    :root {
      color-scheme: light;
      --page: #f3f7f5;
      --surface: #ffffff;
      --surface-muted: #f5f8f6;
      --text: #17231d;
      --muted: #5c6c63;
      --border: #d9e4dc;
      --green: #16734a;
      --green-hover: #105c3a;
      --button-text: #ffffff;
      --green-soft: #e7f4ec;
      --focus: #146c43;
      --shadow: 0 24px 70px rgba(28, 58, 41, .13);
      --success-bg: #e7f4ec;
      --success-text: #145c37;
      --error-bg: #fff0ee;
      --error-text: #9c2f25;
    }

    html[data-theme="dark"] {
      color-scheme: dark;
      --page: #101914;
      --surface: #19241e;
      --surface-muted: #202d25;
      --text: #f1f6f2;
      --muted: #b3c2b8;
      --border: #35463b;
      --green: #5bc58a;
      --green-hover: #77d99f;
      --button-text: #102016;
      --green-soft: #233d2d;
      --focus: #83e3a8;
      --shadow: 0 24px 70px rgba(0, 0, 0, .34);
      --success-bg: #203c2b;
      --success-text: #a8edbf;
      --error-bg: #482b29;
      --error-text: #ffc0b8;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100vh;
      margin: 0;
      padding: 24px;
      display: grid;
      place-items: center;
      background:
        radial-gradient(ellipse at 15% 12%, rgba(73, 164, 111, .14), transparent 34%),
        radial-gradient(ellipse at 90% 88%, rgba(120, 172, 128, .13), transparent 34%),
        var(--page);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      line-height: 1.5;
    }

    button, input { font: inherit; }

    .shell {
      width: min(100%, 470px);
    }

    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-bottom: 16px;
    }

    .toolbar button {
      min-height: 42px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 13px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .toolbar button:hover { background: var(--surface-muted); }
    .toolbar svg { width: 18px; height: 18px; fill: currentColor; }

    .card {
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .accent { height: 5px; background: linear-gradient(90deg, #16734a, #72bd83); }

    .header {
      padding: 34px 34px 24px;
      text-align: center;
    }

    .brand {
      width: 62px;
      height: 62px;
      display: grid;
      place-items: center;
      margin: 0 auto 18px;
      border-radius: 19px;
      background: var(--green-soft);
      color: var(--green);
    }

    .brand svg { width: 34px; height: 34px; fill: currentColor; }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--green);
      font-size: 12px;
      font-weight: 750;
      letter-spacing: .13em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(25px, 6vw, 31px);
      line-height: 1.2;
      letter-spacing: -.025em;
    }

    .description {
      max-width: 340px;
      margin: 12px auto 0;
      color: var(--muted);
      font-size: 15px;
    }

    .content { padding: 0 34px 28px; }

    .form-group { margin-top: 19px; }

    label {
      display: block;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: 650;
    }

    input {
      width: 100%;
      min-height: 52px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      outline: none;
      background: var(--surface-muted);
      color: var(--text);
      text-align: start;
      transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    input::placeholder { color: var(--muted); opacity: 1; }

    input:focus {
      border-color: var(--focus);
      background: var(--surface);
      box-shadow: 0 0 0 3px rgba(22, 115, 74, .18);
    }

    .hint {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 13px;
    }

    .submit {
      width: 100%;
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 25px;
      padding: 12px 18px;
      border: 0;
      border-radius: 12px;
      background: var(--green);
      color: var(--button-text);
      font-weight: 700;
      cursor: pointer;
      transition: transform .18s ease, background .18s ease, box-shadow .18s ease;
    }

    .submit:hover {
      transform: translateY(-1px);
      background: var(--green-hover);
      box-shadow: 0 8px 20px rgba(22, 115, 74, .22);
    }

    .submit:disabled { cursor: wait; opacity: .8; transform: none; }

    :focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }

    input:focus-visible { outline-offset: 2px; }
    [dir="rtl"] .submit svg { transform: scaleX(-1); }

    .status {
      margin: 0 0 16px;
      padding: 12px 14px;
      border-radius: 11px;
      font-size: 14px;
    }

    .status:empty { display: none; }
    .status.success { background: var(--success-bg); color: var(--success-text); }
    .status.error { background: var(--error-bg); color: var(--error-text); }

    .footer {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 16px 24px 20px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 13px;
    }

    .footer svg { width: 16px; height: 16px; fill: var(--green); }

    [dir="rtl"] .toolbar { justify-content: flex-start; }

    @media (max-width: 480px) {
      body { padding: 18px 14px; }
      .header { padding: 28px 22px 20px; }
      .content { padding: 0 22px 24px; }
      .card { border-radius: 20px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: .01ms !important;
        animation-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="toolbar" aria-label="Display options" data-i18n-aria="displayOptions">
      <button id="themeToggle" type="button" aria-label="Switch to dark mode">
        <svg id="themeIcon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A6.5 6.5 0 0 1 13.36 3.1C12.92 3.04 12.46 3 12 3z"/></svg>
        <span id="themeLabel">Switch to dark mode</span>
      </button>
      <button id="languageToggle" type="button" aria-label="Switch language to Hebrew">עברית</button>
    </nav>

    <section class="card" aria-labelledby="pageTitle">
      <div class="accent" aria-hidden="true"></div>
      <header class="header">
        <div class="brand" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M19 4h-2.18A3 3 0 0 0 14 2h-4a3 3 0 0 0-2.82 2H5a2 2 0 0 0-2 2v1h18V6a2 2 0 0 0-2-2zM5 9v10a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V9H5zm4 2h2v8H9v-8zm4 0h2v8h-2v-8z"/></svg>
        </div>
        <p class="eyebrow">S-Bin <span aria-hidden="true">/</span> A02</p>
        <h1 id="pageTitle" data-i18n="title">Smart bin setup</h1>
        <p class="description" data-i18n="description">Connect this device to your organization to get started.</p>
      </header>

      <div class="content">
        <p id="status" class="status" role="status" aria-live="polite" aria-atomic="true"></p>
        <form id="setupForm" action="/setup" method="post">
          <div class="form-group">
            <label for="orgId" data-i18n="orgLabel">Organization ID</label>
            <input id="orgId" name="orgId" type="text" required autocomplete="organization"
                   autocapitalize="none" spellcheck="false" dir="auto"
                   aria-describedby="orgHint" placeholder="e.g. your organization ID">
            <p id="orgHint" class="hint" data-i18n="orgHint">Enter the organization ID provided by your S-Bin administrator.</p>
          </div>
          <div class="form-group">
            <label for="code" data-i18n="codeLabel">Registration code</label>
            <input id="code" name="code" type="text" required autocomplete="off"
                   autocapitalize="characters" spellcheck="false" dir="ltr"
                   aria-describedby="codeHint" placeholder="XXXX-XXXX">
            <p id="codeHint" class="hint" data-i18n="codeHint">The organization's registration code, from the add-device page or its settings.</p>
          </div>
          <button id="submitBtn" class="submit" type="submit">
            <span id="submitLabel" data-i18n="submit">Save and connect</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M5 12h12.17l-5.59-5.59L13 5l7 7-7 7-1.41-1.41L17.17 13H5v-1z"/></svg>
          </button>
        </form>
      </div>

      <footer class="footer">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
        <span data-i18n="footer">Private device setup</span>
      </footer>
    </section>
  </main>

  <script>
    const translations = {
      en: {
        documentTitle: "S-Bin | Device setup",
        title: "Smart bin setup",
        description: "Connect this device to your organization to get started.",
        orgLabel: "Organization ID",
        orgHint: "Enter the organization ID provided by your S-Bin administrator.",
        codeLabel: "Registration code",
        codeHint: "The organization's registration code, from the add-device page or its settings.",
        placeholder: "e.g. your organization ID",
        submit: "Save and connect",
        submitting: "Saving...",
        success: "Settings saved. The device is restarting...",
        error: "Could not save settings",
        errorPrefix: "Error: ",
        footer: "Private device setup",
        displayOptions: "Display options",
        switchToHebrew: "Switch language to Hebrew",
        switchToEnglish: "Switch language to English",
        switchToDark: "Switch to dark mode",
        switchToLight: "Switch to light mode"
      },
      he: {
        documentTitle: "S-Bin | הגדרת מכשיר",
        title: "הגדרת פח חכם",
        description: "חברו את המכשיר לארגון שלכם כדי להתחיל.",
        orgLabel: "מזהה ארגון",
        orgHint: "הזינו את מזהה הארגון שקיבלתם ממנהל מערכת S-Bin.",
        codeLabel: "קוד רישום",
        codeHint: "קוד הרישום של הארגון, מדף הוספת המכשיר או מהגדרות הארגון.",
        placeholder: "לדוגמה: מזהה הארגון שלכם",
        submit: "שמירה והתחברות",
        submitting: "שומר...",
        success: "ההגדרות נשמרו. המכשיר מופעל מחדש...",
        error: "לא ניתן לשמור את ההגדרות",
        errorPrefix: "שגיאה: ",
        footer: "הגדרה מאובטחת של המכשיר",
        displayOptions: "אפשרויות תצוגה",
        switchToHebrew: "מעבר לשפה העברית",
        switchToEnglish: "מעבר לשפה האנגלית",
        switchToDark: "מעבר למצב כהה",
        switchToLight: "מעבר למצב בהיר"
      }
    };

    const themePreference = window.matchMedia("(prefers-color-scheme: dark)");
    let currentLang = (navigator.language || "").toLowerCase().startsWith("he") ? "he" : "en";
    let themeOverride = null;

    function applyLanguage() {
      const text = translations[currentLang];
      document.documentElement.lang = currentLang;
      document.documentElement.dir = currentLang === "he" ? "rtl" : "ltr";
      document.title = text.documentTitle;
      document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.getAttribute("data-i18n");
        if (text[key]) element.textContent = text[key];
      });
      document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
        const key = element.getAttribute("data-i18n-aria");
        if (text[key]) element.setAttribute("aria-label", text[key]);
      });
      document.getElementById("orgId").placeholder = text.placeholder;
      document.getElementById("languageToggle").textContent = currentLang === "he" ? "English" : "עברית";
      document.getElementById("languageToggle").setAttribute(
        "aria-label",
        currentLang === "he" ? text.switchToEnglish : text.switchToHebrew
      );
    }

    function applyTheme() {
      const isDark = themeOverride === null ? themePreference.matches : themeOverride === "dark";
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      const label = translations[currentLang][isDark ? "switchToLight" : "switchToDark"];
      document.getElementById("themeLabel").textContent = label;
      document.getElementById("themeToggle").setAttribute("aria-label", label);
      document.getElementById("themeIcon").innerHTML = isDark
        ? "<path d='M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5h2v3h-2V2zm0 17h2v3h-2v-3zM2 11h3v2H2v-2zm17 0h3v2h-3v-2zM4.93 3.51l2.12 2.12-1.42 1.42-2.12-2.12 1.42-1.42zm12.02 12.02 2.12 2.12-1.42 1.42-2.12-2.12 1.42-1.42zm1.41-12.02 1.42 1.42-2.12 2.12-1.42-1.42 2.12-2.12zM5.63 15.53l1.42 1.42-2.12 2.12-1.42-1.42 2.12-2.12z'/>"
        : "<path d='M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A6.5 6.5 0 0 1 13.36 3.1C12.92 3.04 12.46 3 12 3z'/>";
    }

    document.getElementById("languageToggle").addEventListener("click", () => {
      currentLang = currentLang === "he" ? "en" : "he";
      applyLanguage();
      applyTheme();
    });

    document.getElementById("themeToggle").addEventListener("click", () => {
      const currentlyDark = themeOverride === null ? themePreference.matches : themeOverride === "dark";
      themeOverride = currentlyDark ? "light" : "dark";
      applyTheme();
    });

    function onSystemThemeChange() {
      if (themeOverride === null) applyTheme();
    }

    if (themePreference.addEventListener) {
      themePreference.addEventListener("change", onSystemThemeChange);
    } else {
      themePreference.addListener(onSystemThemeChange);
    }

    document.getElementById("setupForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = translations[currentLang];
      const button = document.getElementById("submitBtn");
      const label = document.getElementById("submitLabel");
      const status = document.getElementById("status");
      button.disabled = true;
      label.textContent = text.submitting;
      status.className = "status";
      status.textContent = "";

      try {
        const response = await fetch("/setup", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams(new FormData(event.currentTarget))
        });
        if (!response.ok) {
          const message = (await response.text()).trim();
          throw new Error(message || text.error);
        }
        status.className = "status success";
        status.textContent = text.success;
        label.textContent = text.submit;
      } catch (error) {
        status.className = "status error";
        status.textContent = text.errorPrefix + (error.message || text.error);
        button.disabled = false;
        label.textContent = text.submit;
      }
    });

    applyLanguage();
    applyTheme();
  </script>
</body>
</html>
)rawliteral";

// The answer to the add-device page's link (GET /setup), which the phone's
// browser shows as is: saved or not, in the phone's language.
const char setupLinkReplyHtml[] PROGMEM = R"rawliteral(<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>S-Bin</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; text-align: center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: #f3f7f5; color: #17231d; }
  p { color: #5c6c63; max-width: 360px; }
  @media (prefers-color-scheme: dark) { body { background: #101914; color: #f1f6f2; } p { color: #b3c2b8; } }
</style></head>
<body><main><h1 id="title"></h1><p id="body"></p></main>
<script>
  const saved = %SAVED%;
  const he = (navigator.language || "").toLowerCase().startsWith("he");
  const text = {
    en: {
      saved: ["Saved", "The device is restarting and will register over cellular. You can go back to the S-Bin app."],
      failed: ["Not saved", "The link is missing the organization or the code, or its location is invalid. Open http://192.168.4.1 to enter them by hand."]
    },
    he: {
      saved: ["נשמר", "המכשיר מופעל מחדש וירשם ברשת הסלולרית. אפשר לחזור לאפליקציית S-Bin."],
      failed: ["לא נשמר", "בקישור חסרים הארגון או הקוד, או שהמיקום בו שגוי. פתחו את http://192.168.4.1 כדי להזין אותם ידנית."]
    }
  }[he ? "he" : "en"][saved ? "saved" : "failed"];
  document.documentElement.lang = he ? "he" : "en";
  document.documentElement.dir = he ? "rtl" : "ltr";
  document.title = "S-Bin | " + text[0];
  document.getElementById("title").textContent = text[0];
  document.getElementById("body").textContent = text[1];
</script></body></html>
)rawliteral";

// Saves the organization, the code and the optional location (orgId, code,
// location) from the setup form or the add-device page's link; false, with
// why, when they are missing or the location is not valid.
bool saveSetupFromRequest(String& error) {
    String submittedOrgId = configServer.arg("orgId");
    String submittedCode = configServer.arg("code");
    submittedOrgId.trim();
    submittedCode.trim();
    if (submittedOrgId.length() == 0 || submittedCode.length() == 0) {
        error = "The organization ID and the registration code are required";
        return false;
    }

    // Optional (only the link carries it): without it the device waits for a
    // GPS fix before registering.
    String submittedLocation = configServer.arg("location");
    submittedLocation.trim();
    float lat = 0;
    float lng = 0;
    if (submittedLocation.length() > 0 && !parseLocation(submittedLocation, lat, lng)) {
        error = "The location must be latitude, longitude (for example 32.0853, 34.7818)";
        return false;
    }

    saveSetup(submittedOrgId, submittedCode);
    if (submittedLocation.length() > 0) {
        saveSetupLocation(lat, lng);
    }
    return true;
}
}

// The device's MAC: its radio's (Wi-Fi station), the one its mesh packets
// carry, esptool prints and an S3's USB port names, so a device has one name
// whether it reports over cellular or through a gateway. Before 2.1.0 this read
// ESP.getEfuseMac()'s bytes from the wrong end (the same MAC reversed).
String getChipMac() {
    uint8_t mac[sbinmesh::MAC_LENGTH];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char macText[18];
    sbinmesh::formatMac(mac, macText);
    return String(macText);
}

void loadDeviceSettings() {
    preferences.begin("credentials", true);
    ownerId = preferences.getString("ownerId", "");
    registrationCode = preferences.getString("regCode", "");
    deviceKey = preferences.getString("deviceKey", "");
    deviceRole = static_cast<DeviceRole>(preferences.getUChar("role", ROLE_UNKNOWN));
    binDepthMm = preferences.getInt("binDepthMm", 0);
    latitude = preferences.getFloat("gpsLat", 0.0f);
    longitude = preferences.getFloat("gpsLon", 0.0f);
    lastGpsUpdateEpoch = static_cast<time_t>(preferences.getLong64("gpsEpoch", 0));
    lastGpsAttemptEpoch = static_cast<time_t>(preferences.getLong64("gpsAttempt", 0));
    nextWakeEpoch = preferences.getULong64("nextWake", 0);
    slotPeriodSeconds = preferences.getUInt("slotPeriod", 0);
    scheduledSleepDurationSeconds = preferences.getUInt("sleepDuration", 0);
    meshAwakeWindowSeconds = preferences.getUInt("meshAwake", DEFAULT_MESH_AWAKE_WINDOW_SECONDS);
    if (meshAwakeWindowSeconds == 0 || meshAwakeWindowSeconds > MAX_MESH_AWAKE_WINDOW_SECONDS) {
        meshAwakeWindowSeconds = DEFAULT_MESH_AWAKE_WINDOW_SECONDS;
    }
    scaleZeroSet = preferences.isKey("scaleZero");
    scaleZero = preferences.getInt("scaleZero", 0);
    scaleCountsPerGram = preferences.getFloat("scaleFactor", 0.0f);
    setupLocationPending = preferences.getBool("setupLoc", false);
    bool hasStoredLocation = preferences.isKey("gpsEpoch");
    preferences.end();
    if (!clockDriftLoaded) {
        driftPpm = 0;
        driftMeasured = sbinmesh::loadBoardDriftPpm(driftPpm);
        clockDriftLoaded = true;
    }
    loadMeshKeys();

    hasGpsFix = hasStoredLocation &&
                latitude >= -90.0f && latitude <= 90.0f &&
                longitude >= -180.0f && longitude <= 180.0f &&
                lastGpsUpdateEpoch > 0;
}

void saveSetup(const String& orgId, const String& code) {
    preferences.begin("credentials", false);
    preferences.putString("ownerId", orgId);
    preferences.putString("regCode", code);
    preferences.end();
}

// The bin's location from the setup page (the installer's phone, next to the
// bin), so registration does not wait for a GPS fix. The page runs before the
// clock is set, so the location gets SETUP_LOCATION_EPOCH instead of a time.
void saveSetupLocation(float lat, float lng) {
    preferences.begin("credentials", false);
    preferences.putFloat("gpsLat", lat);
    preferences.putFloat("gpsLon", lng);
    preferences.putLong64("gpsEpoch", SETUP_LOCATION_EPOCH);
    preferences.remove("gpsAttempt");
    preferences.putBool("setupLoc", true);
    preferences.end();
}

// Once the clock is set: the setup location counts as this month's fix, so GPS
// refines it at the next monthly refresh instead of holding up the first report.
void acceptSetupLocation() {
    if (!setupLocationPending || !isSystemClockValid()) {
        return;
    }
    recordGpsAttempt();
    setupLocationPending = false;
    preferences.begin("credentials", false);
    preferences.remove("setupLoc");
    preferences.end();
    Serial.println("📍 Using the location from the setup page; GPS refines it at the monthly refresh.");
}

// A registration the server refused (a wrong organization or code): forget
// them and restart into the setup page, so they can be entered again.
void reopenSetupPortal() {
    Serial.println("🔁 Registration refused; opening the setup page again.");
    preferences.begin("credentials", false);
    preferences.remove("ownerId");
    preferences.remove("regCode");
    preferences.end();
    delay(500);
    ESP.restart();
}

void saveDeviceKey(const String& key) {
    preferences.begin("credentials", false);
    preferences.putString("deviceKey", key);
    preferences.end();
}

void clearDeviceSettings() {
    preferences.begin("credentials", false);
    preferences.clear();
    preferences.end();
}

bool startConfigurationPortal() {
    String apName = "S-Bin-A02-" + DeviceMac.substring(0, 5);
    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(portalIp, portalIp, IPAddress(255, 255, 255, 0));
    if (!WiFi.softAP(apName.c_str())) {
        Serial.println("❌ Failed to start configuration access point.");
        return false;
    }

    dnsServer.start(dnsPort, "*", portalIp);
    configServer.on("/", HTTP_GET, []() {
        configServer.send_P(200, "text/html; charset=utf-8", setupPortalHtml);
    });
    configServer.on("/setup", HTTP_POST, []() {
        String error;
        if (!saveSetupFromRequest(error)) {
            configServer.send(400, "text/plain", error);
            return;
        }
        configServer.send(200, "text/plain", "Saved. The device is restarting.");
        delay(1000);
        ESP.restart();
    });
    // The add-device page's one-tap link: /setup?orgId=…&code=…&location=lat,lng
    // (an https page cannot send it in the background, so the phone opens it).
    configServer.on("/setup", HTTP_GET, []() {
        String error;
        const bool saved = saveSetupFromRequest(error);
        String page = FPSTR(setupLinkReplyHtml);
        page.replace("%SAVED%", saved ? "true" : "false");
        configServer.send(saved ? 200 : 400, "text/html; charset=utf-8", page);
        if (!saved) {
            Serial.println("⚠️ Setup link refused: " + error);
            return;
        }
        delay(1000);
        ESP.restart();
    });
    configServer.onNotFound([]() {
        configServer.sendHeader("Location", String("http://") + portalIp.toString() + "/");
        configServer.send(302, "text/plain", "");
    });
    configServer.begin();
    configurationPortalActive = true;

    Serial.println("Configuration AP started: " + apName);
    Serial.println("Connect to the AP and open http://192.168.4.1 to enter the organization ID and registration code.");
    return true;
}

void handleConfigurationPortal() {
    dnsServer.processNextRequest();
    configServer.handleClient();
    delay(2);
}
