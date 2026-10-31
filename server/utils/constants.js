import os from "node:os";

// User roles, as stored on users; ROLE_LEVEL ranks them.
export const ROLES = Object.freeze({
    OWNER: "owner",
    ADMIN: "admin",
    TECHNICIAN: "technician",
    // Drives an organization's collection routes; sees only their own routes.
    DRIVER: "driver",
    USER: "user",
})

// Commands a mesh leaf can run; its gateway hands each over in the ACK to the
// leaf's next reading. stay_awake is not among them: a leaf can only talk
// while its gateway's mesh window is open, so staying awake gains nothing.
// become_leaf reaches a gateway that reports through another one this way.
export const LEAF_INSTRUCTION_TYPES = Object.freeze(["report_now", "calibrate_empty_bin", "calibrate_scale", "become_leaf"])

export const ROLE_LEVEL = {
    [ROLES.OWNER]: 4,
    [ROLES.ADMIN]: 3,
    [ROLES.TECHNICIAN]: 2,
    [ROLES.DRIVER]: 2,
    [ROLES.USER]: 1
}

// The AI overview's instructions; {{language}} is the user's app language. The
// data that follows is the fleet briefing (buildFleetBriefing in the analytics
// controller), not raw logs.
export const AI_INSTRUCTIONS = `
You are the operations analyst of a municipal smart-bin network. Your reader is
the operations manager, who decides today's collection rounds and maintenance
visits. Turn the fleet briefing below into exactly four insight cards they can
act on at a glance.

## The data
A JSON fleet briefing, computed by the system from the devices' reports:
- "rules": what the numbers mean. Fullness is the fill level or the weight,
  whichever is higher. A bin is filling up from "fullnessWarningPercent" and
  needs collecting from "fullnessCriticalPercent". A battery is low from
  "batteryWarningPercent" and critical from "batteryCriticalPercent". A device
  is offline after it missed its scheduled reports.
- "totals": counts across the fleet now.
- "lastSevenDays": emptyings, average fullness when emptied, kg collected, and
  problem reports by cause (fillSensor, battery, scale, gps).
- "devices": one entry per device, the most urgent first. "needsAttention"
  lists why: full, maintenance (service date passed), offline, battery, health.
  "hoursUntilCollectionNeeded" (until the bin reaches the critical fullness; 0
  means it already has) and "batteryDaysUntilCritical" are forecasts from the
  recent trend; null means there is not enough data, not that all is well.
  A gateway relays the reports of the bins that report through it.

## The four cards, in this order
1. Collect now: bins at or above the critical fullness, and bins expected to
   reach it within 24 hours. Name the most urgent (up to five) with their fullness or
   time to full. If there are none, say collection can wait and when the next
   bin is expected to fill, if known.
2. Coming up: what changes in the next 24-48 hours (bins expected to fill,
   batteries approaching critical, maintenance falling due). If nothing is
   expected, say so.
3. Devices needing attention: offline devices (with how long since their last
   report; for an offline gateway, that its bins are silent too), critical or
   low batteries, overdue maintenance and reported problems. If all devices
   are healthy and reporting, say so.
4. Recommended actions: two or three concrete steps, most important first,
   each naming the devices it concerns (for example, collect A and B, replace
   the battery in C, check why gateway D stopped reporting).

## Rules
- Use only the data given. Do not guess causes or values that are not in it.
- Refer to devices only by their "name", exactly as given. Never mention ids,
  JSON field names, or technical diagnostics.
- Round numbers sensibly (whole percent, hours or days) and include them only
  where they support a decision.
- "title": at most five words. "content": at most two sentences and about 45
  words, written for a manager, not an engineer.
- Write every title and content in {{language}}; keep device names as given.
- If the briefing has no devices, return an empty "insights" array.

## Output
A JSON object with one key, "insights": an array of four objects, each with
"title" and "content" (strings). Nothing else.

## Fleet briefing
`
// ---- Thresholds and limits. Every number that decides behaviour lives here,
// so a screen, a report and an alert never disagree. The client keeps its own
// copy of the shared ones in client/src/utils/constants.js.

// Time units, for the values below and for code that converts times.
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Fullness: the fill level or the weight against WEIGHT_REFERENCE_KG,
// whichever is closer to full, in %. Warning and critical drive a report's
// severity, the map's colors, "almost full" and the daily alert email; these
// are the defaults of each organization's own (THRESHOLD_SETTINGS).
export const FULLNESS_WARNING_PERCENT = 50;
export const FULLNESS_CRITICAL_PERCENT = 80;
export const WEIGHT_REFERENCE_KG = 250;
// A route without a range from the map's search collects the critical bins
// (the organization's critical cut-off up to full).

// Battery, in %: low at warning, needs replacing at critical (defaults too).
export const BATTERY_WARNING_PERCENT = 50;
export const BATTERY_CRITICAL_PERCENT = 20;
// Each organization's cut-offs: [default, min, max] in %. Warning stays on
// the safe side of critical by at least THRESHOLD_MIN_GAP points (fullness
// warns below critical, a battery warns above it).
export const THRESHOLD_SETTINGS = Object.freeze({
    fullnessWarning: Object.freeze([FULLNESS_WARNING_PERCENT, 20, 90]),
    fullnessCritical: Object.freeze([FULLNESS_CRITICAL_PERCENT, 30, 100]),
    batteryWarning: Object.freeze([BATTERY_WARNING_PERCENT, 10, 80]),
    batteryCritical: Object.freeze([BATTERY_CRITICAL_PERCENT, 5, 40]),
});
export const THRESHOLD_MIN_GAP = 5;

// Reporting schedule (an organization's settings and their defaults). Every
// interval divides 24 hours, so the slots stay aligned; below 30 minutes
// gateways learn no clock drift. The start hour is local to each device.
export const DEFAULT_MESH_AWAKE_WINDOW_SECONDS = 10;
export const MAX_MESH_AWAKE_WINDOW_SECONDS = 60;
export const REPORT_INTERVAL_OPTIONS_MINUTES = Object.freeze([15, 30, 60, 120, 180, 240, 360, 720, 1440]);
export const DEFAULT_REPORT_INTERVAL_MINUTES = 720;
export const DEFAULT_REPORT_START_HOUR = 5;
// Device sleep clocks run fast (about +1%), so a report this close before its
// slot belongs to that slot: the next wake is the slot after it.
export const EARLY_WAKE_TOLERANCE_SECONDS = 600;
// A device is offline once it has missed this many reports in a row; the grace
// covers a report that arrives a little late.
export const OFFLINE_AFTER_MISSED_REPORTS = 2;
export const OFFLINE_GRACE_MS = 10 * MINUTE_MS;

// Mesh relays. A queued leaf reading timed beyond these limits is logged at
// its arrival instead.
export const MAX_MESH_HOPS = 8;
export const RECENT_MESH_MESSAGE_IDS = 8;
export const MAX_READING_AGE_MS = 7 * DAY_MS;
export const MAX_READING_AHEAD_MS = 2 * MINUTE_MS;
// Leaf commands per instruction check, one per leaf (its oldest), so each leaf
// runs its commands in order and the reply stays small for the gateway.
export const MAX_LEAF_INSTRUCTIONS = 4;

// Device commands. The known weight for calibrate_scale is in grams, and the
// device checks the same range.
export const MAX_AWAKE_EXTENSION_SECONDS = 3600;
export const MIN_SCALE_CALIBRATION_GRAMS = 100;
export const MAX_SCALE_CALIBRATION_GRAMS = 200000;
// A command still pending this long means its device has not checked in.
export const INSTRUCTION_RETENTION_MS = 3 * DAY_MS;

// Analytics. A drop this large between two reports means the bin was emptied
// (a weight drop needs both the ratio and the kg, so scale noise near empty
// is no emptying); a trend (fill rate, battery drain) needs this many reports
// over this long.
export const ANALYTICS_RANGES_DAYS = Object.freeze([7, 30, 90]);
export const DEFAULT_RANGE_DAYS = 30;
export const COLLECTION_LEVEL_DROP = 30;
export const COLLECTION_WEIGHT_DROP_RATIO = 0.5;
export const COLLECTION_WEIGHT_DROP_MIN_KG = 2;
export const FILL_RATE_WINDOW_DAYS = 14;
export const BATTERY_TREND_DAYS = 14;
export const MIN_TREND_POINTS = 3;
export const MIN_TREND_SPAN_MS = DAY_MS;
export const FULL_SOON_HOURS = Object.freeze([24, 48]);
// The daily report names bins that will need collecting within this long.
export const DAILY_REPORT_DUE_WITHIN_HOURS = 24;
export const BATTERY_SOON_DAYS = 30;
export const RELIABILITY_DAYS = Object.freeze([7, 30]);
export const FULLNESS_BUCKETS = Object.freeze([[0, 25], [25, 50], [50, 75], [75, 101]]);
export const BATTERY_BUCKETS = Object.freeze([
    [0, BATTERY_CRITICAL_PERCENT], [BATTERY_CRITICAL_PERCENT, BATTERY_WARNING_PERCENT],
    [BATTERY_WARNING_PERCENT, 80], [80, 101],
]);

// List lengths in responses.
export const FULL_SOON_LIST_LIMIT = 20;
export const BATTERY_SOON_LIST_LIMIT = 10;
export const LEAST_RELIABLE_LIMIT = 5;
export const GATEWAY_LIST_LIMIT = 10;
export const ATTENTION_LIST_LIMIT = 50;
export const RECENT_LOGS_LIMIT = 50;

// Accounts: failed one-time-code guesses allowed before the code is discarded.
export const MAX_OTP_ATTEMPTS = 5;

// Device report validation: a value beyond these is not plausible.
export const REPORT_MESSAGE_MAX_LENGTH = 256;
export const MAX_LAST_AWAKE_SECONDS = DAY_MS / SECOND_MS;
export const MAX_ABS_DRIFT_PPM = 100000;
export const MAX_ABS_CLOCK_ERROR_SECONDS = DAY_MS / SECOND_MS;
export const RANDOM_TOKEN_BYTES = 32;

// Device commands: sizes the database and the devices accept, and how many a
// bin page lists.
export const INSTRUCTION_TYPE_MAX_LENGTH = 64;
export const INSTRUCTION_PAYLOAD_MAX_BYTES = 256;
export const INSTRUCTION_RESULT_MAX_LENGTH = 256;
export const INSTRUCTIONS_LIST_LIMIT = 100;

// Maintenance: a new bin's first service, and the next one after each visit.
export const FIRST_SERVICE_AFTER_DAYS = 90;
export const SERVICE_INTERVAL_DAYS = 30;

// Lists and routes.
export const DEFAULT_PAGE_SIZE = 10;
export const RECENT_LOGS_HOURS = 24;
export const LOG_TYPES_DAYS = 30;
// An organization's garbage trucks, which its daily routes are planned for.
// The presets are the common classes (axles, maximum total weight in tons and
// a payload in kg at the low end of the class's range, so a plan does not
// overload a truck); the organization edits them.
export const TRUCK_PRESETS = Object.freeze({
    small: Object.freeze({ axles: 2, maxTotalTons: 18, capacityKg: 5000 }),
    medium: Object.freeze({ axles: 3, maxTotalTons: 26, capacityKg: 10000 }),
    large: Object.freeze({ axles: 4, maxTotalTons: 32, capacityKg: 13000 }),
});
export const MAX_TRUCK_TYPES = 10;
export const MAX_TRUCKS_PER_TYPE = 50;
export const MIN_TRUCK_CAPACITY_KG = 500;
export const MAX_TRUCK_CAPACITY_KG = 20000;
export const TRUCK_NAME_MAX_LENGTH = 40;
export const DEPOT_ADDRESS_MAX_LENGTH = 120;
// A truck type's diesel use: garbage trucks stop and start all day, 57-141 L
// per 100 km in published fleets, about 77 on average.
export const DEFAULT_TRUCK_LITERS_PER_100KM = 77;
export const TRUCK_LITERS_PER_100KM_RANGE = Object.freeze([10, 200]);
// What collecting costs an organization (in ₪), for the money its routes
// spend and the system saves; each organization edits its own. The landfill
// levy is the 2025 rate for mixed waste (index-linked); the site's entry fee
// differs by up to 300% between sites, so it starts empty. The system is paid
// per device (bins and gateways) a month, its hardware spread over its life,
// so it grows with the devices on its own. The baseline is how
// often a bin was emptied before the system (a fixed schedule), which the
// savings are counted against. Each value: [default, min, max].
export const COST_SETTINGS = Object.freeze({
    dieselPerLiter: Object.freeze([7.5, 0, 50]),
    crewPerHour: Object.freeze([180, 0, 2000]),
    landfillLevyPerTonne: Object.freeze([117.22, 0, 1000]),
    disposalFeePerTonne: Object.freeze([0, 0, 2000]),
    systemPerDevicePerMonth: Object.freeze([0, 0, 10000]),
    baselineCollectionsPerWeek: Object.freeze([3, 0.25, 14]),
});
// The money: a collection's fuel and crew cost is learned from the routes
// driven in the last COST_PER_COLLECTION_DAYS (or, before any was driven,
// from those planned); burning a litre of diesel emits CO2_KG_PER_DIESEL_LITER.
export const COST_PER_COLLECTION_DAYS = 90;
export const CO2_KG_PER_DIESEL_LITER = 2.68;
export const DAYS_PER_MONTH = 365.25 / 12;
// Each organization's day in numbers (orgstats): computed from the day's
// reports and the day before it (a report interval is at most a day, so the
// last reading before an emptying is in it), for the last STATS_DAYS. A day
// is settled once computed STATS_SETTLE_MS after it ended (late reports in);
// until then it is computed again when older than STATS_REFRESH_MS. Days are
// filled STATS_CHUNK_DAYS at a time.
export const STATS_DAYS = 90;
// Storage: a log (one report) is kept LOG_RETENTION_DAYS (the analytics show
// at most 90; the long history is in orgstats), a report's diagnostics
// DIAGNOSTICS_RETENTION_DAYS (the bin keeps its latest); MongoDB deletes them
// itself (TTL indexes).
export const LOG_RETENTION_DAYS = 90;
export const DIAGNOSTICS_RETENTION_DAYS = 30;
// A device's problems, found in its reports' diagnostics and raised to owners
// (status.issues; see utils/deviceIssues.js). A condition closes in the first
// report that reads fine again; an event (a restart) stays open
// DEVICE_EVENT_ISSUE_DAYS after it last happened, so it is seen.
export const DEVICE_ISSUE_TYPES = Object.freeze([
    'unexpected_restart', 'weak_signal', 'overheating', 'noisy_sensor', 'slow_cycle', 'weak_mesh_link',
]);
export const DEVICE_ISSUE_LIMITS = Object.freeze({
    weakRsrpDbm: -110,          // below this in two reports in a row
    hotTempC: 70,               // the chip or the power chip
    minDistanceSamples: 3,      // of the A02's five
    noisyDistanceSpreadMm: 50,
    slowCycleMs: 60 * 1000,     // modem, network and server connection together
    leafMissedBeacons: 2,
    weakBeaconRssiDbm: -90,
});
export const DEVICE_EVENT_ISSUE_DAYS = 7;
// Restarts that mean something went wrong; a power-on that no timer woke is
// the power chip cutting the power (or someone pressing reset).
export const FAULT_RESET_REASONS = Object.freeze(['panic', 'interrupt_wdt', 'task_wdt', 'other_wdt', 'brownout', 'power_glitch', 'cpu_lockup']);
export const STATS_LOOKBACK_MS = DAY_MS;
export const STATS_SETTLE_MS = DAY_MS;
export const STATS_REFRESH_MS = HOUR_MS;
export const STATS_CHUNK_DAYS = 10;
// Bins whose fill rate is stale are worked out this many at a time.
export const FILL_RATE_CHUNK_BINS = 500;
// The route optimizer, chosen by ROUTE_ENGINE in the environment: the
// self-hosted VROOM with OSRM (see docker-compose.yml), or OpenRouteService's
// free service. A route visits at most `maxBins` bins, the most urgent first:
// OpenRouteService allows a 3500-entry table of every location to every
// other, so 59 locations with the start (59² = 3481); our VROOM takes far
// more. `maxFleetBins` is the same for the nightly plan of a whole fleet
// (OSRM's table takes 1,000 locations, depot included). `profile` is the road
// profile each engine knows. The time per stop guides the order.
export const ROUTE_ENGINES = Object.freeze({
    vroom: Object.freeze({ maxBins: 300, maxFleetBins: 900, profile: Object.freeze({ collection: 'car', maintenance: 'car' }) }),
    ors: Object.freeze({ maxBins: 58, maxFleetBins: 58, profile: Object.freeze({ collection: 'driving-hgv', maintenance: 'driving-car' }) }),
});
export const DEFAULT_ROUTE_ENGINE = 'ors';
export const ROUTE_STOP_SECONDS = Object.freeze({ maintenance: 30 * 60, collection: 2 * 60 });
// A route's life: planned (built, maybe assigned), driving, then finished or
// cancelled. While a route is open its bins are reserved for it alone.
export const ROUTE_STATUSES = Object.freeze(['planned', 'driving', 'finished', 'cancelled']);
export const OPEN_ROUTE_STATUSES = Object.freeze(['planned', 'driving']);
export const ROUTE_TYPES = Object.freeze(['collection', 'maintenance']);
export const ROUTE_SOURCES = Object.freeze(['manual', 'auto']);
export const ROUTE_STOP_STATUSES = Object.freeze(['planned', 'done', 'skipped']);
// Bins another plan reserved in the same moment: the plan is made again
// without them, at most this many times.
export const ROUTE_PLAN_ATTEMPTS = 3;
// A reservation the day's closing never released (2g-6) lapses this long
// after the end of its service day.
export const ROUTE_RESERVATION_GRACE_HOURS = 24;
// The nightly plan: at the organization's planning hour (local; null turns it
// off) every free truck gets a route from the depot, through the bins that
// need collecting or are forecast to within ROUTE_PLAN_HORIZON_HOURS, the most
// urgent first, at most the engine's maxFleetBins (see ROUTE_ENGINES).
export const DEFAULT_ROUTE_PLANNING_HOUR = 0;
export const ROUTE_PLAN_HORIZON_HOURS = 24;
// The optimizer gets the most urgent bins up to this many times what the free
// trucks carry: enough to choose a good split, without solving for bins no
// truck can take (900 bins took 50 s on the VM's one core).
export const ROUTE_FLEET_CANDIDATE_FACTOR = 2;
// A day's open routes close this long after the day's last report slot (its
// reports in): their bins are freed. A claim no report settled within
// ROUTE_CLAIM_VERIFY_HOURS stays unverified; a contradicted one shows in Needs
// attention for ROUTE_CONTRADICTION_RECENT_HOURS.
export const ROUTE_DAY_CLOSE_GRACE_MINUTES = 30;
export const ROUTE_CLAIM_VERIFY_HOURS = 36;
export const ROUTE_CONTRADICTION_RECENT_HOURS = 24;
// The map groups nearby devices below this zoom; each organization picks its
// own within the range (12 a neighbourhood, 18 single buildings).
export const DEFAULT_CLUSTER_UNTIL_ZOOM = 17;
export const CLUSTER_ZOOM_RANGE = Object.freeze([12, 18]);
// The time zone of an organization without a depot or devices to tell it.
export const DEFAULT_TIME_ZONE = 'Asia/Jerusalem';
// A map view with more devices than this comes as grid cells (a count each)
// instead of the devices; a cell is about MAP_CELL_PX across on screen.
export const MAP_VIEW_LIMIT = 2000;
export const MAP_CELL_PX = 80;

// The AI overview: the model, the window its briefing covers and how many
// devices it lists (the most urgent first).
export const AI_MODEL = 'gemini-2.5-flash';
export const AI_BRIEFING_DAYS = 7;
export const AI_BRIEFING_DEVICE_LIMIT = 60;

// Accounts and sessions.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 30;
export const PASSWORD_HASH_ROUNDS = 10;
export const SESSION_DAYS = 3;
export const RESET_TOKEN_MINUTES = 5;
export const ACCOUNT_VERIFICATION_HOURS = 24;
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
// Requests per IP in each window: the whole API, and the sign-in endpoints.
export const RATE_LIMIT_WINDOW_MS = 15 * MINUTE_MS;
export const API_RATE_LIMIT = 600;
export const AUTH_RATE_LIMIT = 10;
// A new device registers over HTTPS with its organization's registration code
// (2i): wrong codes from one address are limited to this many a window
// (devices on one operator can share an address, so successes do not count).
export const DEVICE_REGISTRATION_FAILURE_LIMIT = 20;
// Registration codes: unambiguous letters and digits (no 0/O, 1/I/L), shown
// as two groups of four; compared without case or the dash.
export const REGISTRATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REGISTRATION_CODE_LENGTH = 8;

// An organization's mesh key (2m; see utils/meshKeys.js): its size in bytes,
// and how many generations the one-byte key ID in a packet can name (1 to 255;
// 0 means no key).
export const MESH_KEY_BYTES = 32;
export const MESH_KEY_ID_COUNT = 255;

// A leaf without a SIM joins the mesh with a one-time join code from the add-bin
// wizard (see utils/joinCodes.js): valid this long, bound to the first leaf that
// uses it, and an organization keeps this many unused ones (the newest).
export const JOIN_CODE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_JOIN_CODES = 20;
// Wrong proofs for one code before it is deleted.
export const MAX_JOIN_PROOF_FAILURES = 5;

// A developer's machine leaves the devices, the scheduled jobs and real emails
// to the deployed server (running them too would store every device report
// twice and send every email twice), and accepts the local client's origin.
// It is marked by SBIN_DEV_MACHINE in its shell profile, set to the computer's
// own name: a copy of the setting on any other computer (the VM) does nothing
// there. Read from the process environment, which exists before the server
// starts, unlike .env.
const shortHostname = (name) => String(name ?? "").trim().toLowerCase().replace(/\.local$/, "");
export const IS_DEV_MACHINE = Boolean(process.env.SBIN_DEV_MACHINE) &&
    shortHostname(process.env.SBIN_DEV_MACHINE) === shortHostname(os.hostname());
// The client's dev server, allowed only on a developer's machine.
export const LOCAL_CLIENT_ORIGIN = "http://localhost:5173";

// The MQTT broker is the private one in .env: MQTT_BROKER_URL,
// MQTT_BROKER_USERNAME and MQTT_BROKER_PASSWORD (the server's own account).
// On the private broker (Mosquitto's dynamic security) each device has an
// account: its MAC, its device key as the password, and a role of its own
// (DEVICE_ROLE_PREFIX + MAC) that lets it publish and read only its own topics,
// written out (Mosquitto 2.0 does not fill %u into role ACLs). The server keeps
// them in step, BROKER_ACCOUNT_BATCH commands a message.
export const DEVICE_ROLE_PREFIX = "device-";
export const BROKER_CONTROL_TOPIC = "$CONTROL/dynamic-security/v1";
export const BROKER_ACCOUNT_BATCH = 100;
export const BROKER_CONTROL_TIMEOUT_MS = 10 * SECOND_MS;
export const MQTT_CONNECT_TIMEOUT_MS = 5 * SECOND_MS;
export const MQTT_RECONNECT_MS = SECOND_MS;

// Scheduled jobs (cron, in the server's time zone).
export const CRON_SCHEDULES = Object.freeze({
    dailyReportEmail: "0 8 * * *",
    instructionCleanup: "15 * * * *",
    activationTokenCleanup: "0 0 * * *",
    otpCleanup: "*/5 * * * *",
    // Hourly: the days whose last reports are in close, then each organization
    // is planned when its planning hour comes.
    routePlanning: "2 * * * *",
    // Hourly: each organization's recent days in numbers (and any missing).
    orgStats: "12 * * * *",
    // Hourly: the private broker's device accounts match the bins (a deletion
    // the broker missed, e.g. made from a developer machine, is caught here).
    brokerAccounts: "27 * * * *",
});
