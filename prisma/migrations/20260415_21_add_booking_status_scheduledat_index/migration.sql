-- Performance: index for system jobs that query bookings by status + scheduledAt
-- without filtering by clientId/providerId (autoExpireStaleBookings, releaseDueAttendanceCodes).
CREATE INDEX IF NOT EXISTS "Booking_status_scheduledAt_idx"
  ON "Booking" ("status", "scheduledAt");
