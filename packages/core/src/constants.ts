/**
 * Tunable rules shared by every surface. These are requirements, not
 * preferences: the mobile app, the web app and the server must all agree, so
 * they live here and are imported rather than retyped.
 *
 * Each constant cites the requirement it implements (docs/PLAN.md).
 */

/** FR-9 — a position update is sent at most this often. */
export const MIN_POSITION_INTERVAL_MS = 15_000;

/** FR-9 — ...and only once the device has moved at least this far. */
export const MIN_POSITION_DISTANCE_M = 25;

/** FR-11 — an ETA is recomputed at most this often per participant. */
export const MIN_ETA_INTERVAL_MS = 45_000;

/** FR-11 — ...or immediately once they have moved this far. */
export const ETA_RECOMPUTE_DISTANCE_M = 300;

/** FR-11 — beyond this age a position is shown as stale and greyed out. */
export const POSITION_STALE_AFTER_MS = 2 * 60_000;

/** FR-11 — beyond this age the ETA is hidden entirely and "last seen" shown. */
export const POSITION_EXPIRED_AFTER_MS = 10 * 60_000;

/** FR-10 — inside this radius of the venue, tracking switches to high accuracy. */
export const APPROACH_RADIUS_M = 5_000;

/** FR-14 — arrival geofence radius around the venue. */
export const ARRIVAL_RADIUS_M = 150;

/** FR-14 — how long a device must stay inside the geofence to count as arrived. */
export const ARRIVAL_DWELL_MS = 60_000;

/** FR-10 — hard stop, so a tracking task can never outlive its event. */
export const TRACKING_SAFETY_TIMEOUT_MS = 4 * 60 * 60_000;

/** FR-9 — check-in opens this long before the event starts... */
export const CHECKIN_OPENS_BEFORE_MS = 2 * 60 * 60_000;

/** FR-9 — ...and closes this long after. */
export const CHECKIN_CLOSES_AFTER_MS = 3 * 60 * 60_000;

/** FR-2 — display names are free text within these bounds. */
export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 24;

/** FR-15 — feed messages are text only, within these bounds. */
export const MESSAGE_MIN = 1;
export const MESSAGE_MAX = 500;

/** FR-2 — soft cap on participants; the design targets 4–10. */
export const MAX_PARTICIPANTS = 20;
