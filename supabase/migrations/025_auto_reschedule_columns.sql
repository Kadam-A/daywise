-- Migration 025: Dedicated auto-reschedule columns
--
-- Moves auto_reschedule_* out of personality_data JSONB into proper typed columns
-- on user_profiles so they can never be accidentally overwritten by personality saves.

-- 1. Add dedicated columns
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS auto_reschedule_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_reschedule_morning   integer NOT NULL DEFAULT 540,   -- minutes from midnight
  ADD COLUMN IF NOT EXISTS auto_reschedule_evening   integer NOT NULL DEFAULT 1140,  -- minutes from midnight
  ADD COLUMN IF NOT EXISTS auto_reschedule_tz_offset numeric;                        -- UTC offset hours, nullable

-- 2. Migrate existing values out of JSONB
UPDATE public.user_profiles
SET
  auto_reschedule_enabled = COALESCE(
    (personality_data->>'auto_reschedule_enabled')::boolean,
    true
  ),
  auto_reschedule_morning = COALESCE(
    CASE
      WHEN (personality_data->>'auto_reschedule_morning')::numeric < 24
        THEN ((personality_data->>'auto_reschedule_morning')::numeric * 60)::integer
      ELSE (personality_data->>'auto_reschedule_morning')::integer
    END,
    540
  ),
  auto_reschedule_evening = COALESCE(
    CASE
      WHEN (personality_data->>'auto_reschedule_evening')::numeric < 24
        THEN ((personality_data->>'auto_reschedule_evening')::numeric * 60)::integer
      ELSE (personality_data->>'auto_reschedule_evening')::integer
    END,
    1140
  ),
  auto_reschedule_tz_offset = (personality_data->>'auto_reschedule_tz_offset')::numeric
WHERE personality_data IS NOT NULL;

-- 3. Remove stale keys from JSONB so personality_data is clean
UPDATE public.user_profiles
SET personality_data = personality_data
  - 'auto_reschedule_enabled'
  - 'auto_reschedule_morning'
  - 'auto_reschedule_evening'
  - 'auto_reschedule_tz_offset';
