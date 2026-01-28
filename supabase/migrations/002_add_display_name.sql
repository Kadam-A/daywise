-- =====================================================
-- MIGRATION: Add display_name to user_profiles
-- =====================================================
-- Auto-populated from Google profile on signup

-- Add display_name column
ALTER TABLE user_profiles
ADD COLUMN display_name TEXT;

-- Update the trigger function to capture display name from Google
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON COLUMN user_profiles.display_name IS 'User display name, auto-populated from Google profile';
