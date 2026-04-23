-- Migration 026: Add IANA timezone name column
--
-- Replaces fragile numeric tz_offset with a proper IANA timezone string
-- (e.g. "America/New_York"). Intl.DateTimeFormat with an IANA name is
-- DST-aware, so it stays correct when clocks change.
-- The numeric offset column is kept as a fallback for old clients.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS auto_reschedule_tz_name text; -- e.g. "America/New_York"
