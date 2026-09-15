-- FR-14 — arrival needs dwell, not just proximity.
--
-- A single fix inside the geofence is not arrival: GPS drifts indoors and
-- people walk past the door on their way to park. We record when a device
-- first went continuously inside the radius; leaving resets it to null.

alter table participants
  add column arrival_dwell_since timestamptz;

comment on column participants.arrival_dwell_since is
  'When this device last entered the arrival radius continuously. Null when '
  'outside. Arrival fires once this has held for ARRIVAL_DWELL_MS.';
