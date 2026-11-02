export const SERVER_URL = import.meta.env.VITE_API_URL;

export const BINS_EP = 'api/bins'
export const LOGS_EP = 'api/logs'
export const USERS_EP = 'api/users'
export const AUTH_EP = 'api/auth'
export const OVERVIEW_EP = 'api/overviews'
export const ORG_EP = 'api/organizations'
export const ROUTES_EP = 'api/routes'

// The AI overview is kept in the browser this long (it is slow and costs a
// model call), one per organization an owner looks at; renaming the key drops
// overviews made from older instructions.
export const CACHE_KEY = 'aiOverviews'
export const LEGACY_CACHE_KEYS = Object.freeze(['aiCache', 'aiOverview'])
export const CACHE_TTL = 60 * 60 * 1000
// The organization an owner last picked on the dashboard and analytics page.
export const SELECTED_ORG_STORAGE_KEY = 'selectedOrganization'
// ---- Thresholds and limits. Every number that decides behaviour lives here;
// the shared ones match the server's (server/utils/constants.js).

const MINUTE_MS = 60 * 1000

// Fullness: the fill level or the weight against WEIGHT_REFERENCE_KG,
// whichever is closer to full, in %. Warning and critical color the map and
// mark a bin as filling up or almost full.
export const FULLNESS_WARNING_PERCENT = 50
export const FULLNESS_CRITICAL_PERCENT = 80
export const WEIGHT_REFERENCE_KG = 250
// The map search's fullness range before the user sets one: every bin, as the
// map shows them.
export const DEFAULT_SEARCH_FULLNESS = Object.freeze([0, 100])
// The local hour an organization's routes are planned every night, by default.
export const DEFAULT_ROUTE_PLANNING_HOUR = 0
// A route's area by default; it collects from the organization's critical
// fullness up (a truck still fills up with the fullest first).
export const DEFAULT_ROUTE_RADIUS_KM = 10
// The planner's collection area: its radius moves in half kilometres, up to a city's size.
export const ROUTE_AREA_RADIUS_STEP_KM = 0.5
export const ROUTE_AREA_MAX_RADIUS_KM = 50

// Battery, in %: low at warning, needs replacing at critical.
export const BATTERY_WARNING_PERCENT = 50
export const BATTERY_CRITICAL_PERCENT = 20
// Each organization's cut-offs, as the server checks them: [default, min, max]
// in %, warning at least THRESHOLD_MIN_GAP on the safe side of critical. The
// four above are the defaults.
export const THRESHOLD_SETTINGS = Object.freeze({
    fullnessWarning: Object.freeze([FULLNESS_WARNING_PERCENT, 20, 90]),
    fullnessCritical: Object.freeze([FULLNESS_CRITICAL_PERCENT, 30, 100]),
    batteryWarning: Object.freeze([BATTERY_WARNING_PERCENT, 10, 80]),
    batteryCritical: Object.freeze([BATTERY_CRITICAL_PERCENT, 5, 40]),
})
export const THRESHOLD_MIN_GAP = 5
export const DEFAULT_THRESHOLDS = Object.freeze(Object.fromEntries(
    Object.entries(THRESHOLD_SETTINGS).map(([field, [byDefault]]) => [field, byDefault])))

// Reporting schedule options and defaults. Every interval divides 24 hours.
export const MAX_MESH_AWAKE_WINDOW_SECONDS = 60
export const REPORT_INTERVAL_OPTIONS_MINUTES = Object.freeze([15, 30, 60, 120, 180, 240, 360, 720, 1440])
export const DEFAULT_REPORT_INTERVAL_MINUTES = 720
export const DEFAULT_REPORT_START_HOUR = 5

// Device commands; the known weight for a scale calibration is in grams, and
// the device checks the same range.
export const MAX_AWAKE_MINUTES = 60
export const MIN_SCALE_GRAMS = 100
export const MAX_SCALE_GRAMS = 200000
export const MAX_BIN_NAME_LENGTH = 25
export const INSTRUCTIONS_PAGE_SIZE = 5
// A bin page's logs table shows this many logs a page.
export const BIN_LOGS_PAGE_SIZE = 6
// Settings saved as they change wait this long after the last change, so
// quick clicks go out as one request.
export const SETTINGS_SAVE_DELAY_MS = 800
// The account page's section list marks the last section whose top passed a
// line this far below the top of the screen. Over the last stretch of
// scrolling (this share of the screen) the line slides down to the bottom,
// so short sections at the end each get their turn. A clicked section stays
// marked this long while the page scrolls to it.
export const SECTION_LINE_OFFSET_PX = 96
export const SECTION_LINE_SLIDE_SHARE = 0.6
export const SECTION_CLICK_HOLD_MS = 1000
// An organization's trucks, as the server checks them (server/utils/constants.js):
// the common classes with a payload at the low end of their range.
export const TRUCK_PRESETS = Object.freeze({
    small: Object.freeze({ axles: 2, maxTotalTons: 18, capacityKg: 5000 }),
    medium: Object.freeze({ axles: 3, maxTotalTons: 26, capacityKg: 10000 }),
    large: Object.freeze({ axles: 4, maxTotalTons: 32, capacityKg: 13000 }),
})
export const MAX_TRUCK_TYPES = 10
export const MAX_TRUCKS_PER_TYPE = 50
export const MIN_TRUCK_CAPACITY_KG = 500
export const MAX_TRUCK_CAPACITY_KG = 20000
export const TRUCK_NAME_MAX_LENGTH = 40
// A truck type's diesel use (L per 100 km): garbage trucks average about 77.
export const DEFAULT_TRUCK_LITERS_PER_100KM = 77
export const TRUCK_LITERS_PER_100KM_RANGE = Object.freeze([10, 200])
// What collecting costs an organization (in ₪), as the server checks it: each
// value [default, min, max] (server/utils/constants.js).
export const COST_SETTINGS = Object.freeze({
    dieselPerLiter: Object.freeze([7.5, 0, 50]),
    crewPerHour: Object.freeze([180, 0, 2000]),
    landfillLevyPerTonne: Object.freeze([117.22, 0, 1000]),
    disposalFeePerTonne: Object.freeze([0, 0, 2000]),
    systemPerDevicePerMonth: Object.freeze([0, 0, 10000]),
    baselineCollectionsPerWeek: Object.freeze([3, 0.25, 14]),
})
export const DEPOT_ADDRESS_MAX_LENGTH = 120
// Password length, as the server checks it.
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 30

// Map. Below the organization's cluster zoom (CLUSTER_UNTIL_ZOOM when it has
// none, within CLUSTER_ZOOM_RANGE) nearby devices group into one marker; the
// user's location marker stays USER_MARKER_MS after "My location". The map
// page loads the devices in view once the map stops moving for
// MAP_VIEW_DEBOUNCE_MS, and first opens around all of them, no closer than
// MAP_FIT_MAX_ZOOM (one device, or several at one spot, is a single point).
export const DEFAULT_RADIUS_KM = 5
export const MAX_RADIUS_KM = 100
export const CLUSTER_UNTIL_ZOOM = 17
export const CLUSTER_ZOOM_RANGE = Object.freeze([12, 18])
export const USER_MARKER_MS = MINUTE_MS
export const MAP_VIEW_DEBOUNCE_MS = 300
export const MAP_FIT_MAX_ZOOM = 15
// The route planner's map draws every bin in reach; while it redraws, a
// trackpad's scrolling piles up and Leaflet zooms by the whole pile. So its
// zoom stays within a city's range and moves a level per this much scroll.
export const PLAN_MAP_MIN_ZOOM = 8
export const PLAN_MAP_MAX_ZOOM = 17
export const PLAN_MAP_WHEEL_PX_PER_ZOOM_LEVEL = 150
export const PLAN_MAP_WHEEL_DEBOUNCE_MS = 80
// Driving a route: a stop counts as reached within NAV_ARRIVED_METERS, and the
// map follows the driver at NAV_FOLLOW_ZOOM or closer.
export const NAV_ARRIVED_METERS = 30
export const NAV_FOLLOW_ZOOM = 16
// Driving page: how long it waits for a first GPS fix to order the stops from
// the driver's position (then it starts with the planned order).
export const NAV_START_POSITION_WAIT_MS = 6 * 1000
// A stop marked done farther than this from its bin is flagged (never refused).
export const ROUTE_CLAIM_FAR_METERS = 100

// Analytics ranges (days) and how fresh data stays. Devices report hours
// apart: lists refresh once a minute, a dashboard left open every two, and
// nothing refreshes while the tab is hidden.
export const ANALYTICS_RANGES_DAYS = Object.freeze([7, 30, 90])
export const ANALYTICS_STALE_MS = 5 * MINUTE_MS
export const DASHBOARD_REFRESH_MS = 2 * MINUTE_MS
export const LIST_REFRESH_MS = MINUTE_MS
// A pending command is refreshed until its device picks it up.
export const PENDING_INSTRUCTIONS_REFRESH_MS = 30 * 1000

// The landing page and the app are served from two hosts of one build: the
// landing page from the host named here, the app from every other one (the
// landing page's "Log in" goes to APP_URL). Locally neither is set, the app is
// at localhost, and landing.localhost shows the landing page.
export const LANDING_HOST = import.meta.env.VITE_LANDING_HOST || "landing.localhost"
export const APP_URL = import.meta.env.VITE_APP_URL || "http://localhost:5173"

// Where "Get a demo" requests on the landing page are mailed. Replace with the real address.
export const DEMO_EMAIL = "demo@sbin.example"
