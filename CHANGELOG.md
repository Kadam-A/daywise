# Changelog

All notable changes to TailoredTime will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Supabase authentication integration
- Google Calendar OAuth + sync
- OpenAI Edge Function for AI ranking
- Functional task creation (SMART/MANUAL)
- Auto-reschedule background job
- Push notifications
- Actual PersonalitySlider component with gestures

---

## [1.0.0] - 2026-01-20

### 🎉 Initial Release - MVP Foundation Complete

This release establishes the complete app structure, architecture, and placeholder UI. The app runs and navigates correctly, but data persistence and API integrations are not yet implemented.

### Added

#### Project Setup
- ✅ Initialized Expo app with TypeScript and blank template
- ✅ Installed all core dependencies:
  - `@supabase/supabase-js` (v2.90.1)
  - `react-native-paper` (v5.14.5)
  - `expo-auth-session` (v7.0.10)
  - `expo-secure-store` (v6.0.20)
  - `expo-notifications` (v0.32.16)
  - `@react-native-community/netinfo` (v11.4.1)
  - `date-fns` (v4.1.0)
  - And more (see package.json)

#### App Structure
- ✅ Configured Expo Router for file-based navigation
- ✅ Set up React Native Paper theme with TailoredTime brand colors
- ✅ Created route groups for authentication and tabs
- ✅ Implemented auth redirect logic in index.tsx

#### Authentication Flow
- ✅ **Login Screen** (`app/(auth)/login.tsx`)
  - Google OAuth placeholder button
  - Brand identity with logo and tagline
  - Material Design UI with React Native Paper
- ✅ **Onboarding Screen** (`app/(auth)/onboarding.tsx`)
  - 6-slider personality quiz (placeholders)
  - Improved dimensions: chronotype, focus_duration, deadline_style, break_frequency, task_switching, structure_preference
  - ScrollView for better UX on small screens

#### Main App Tabs
- ✅ **Home Screen** (`app/(tabs)/home.tsx`)
  - Calendar view placeholder
  - FAB for quick task creation
  - "Coming Soon" card with instructions
- ✅ **Add Task Screen** (`app/(tabs)/add-task.tsx`)
  - Task creation form with validation
  - SMART vs MANUAL scheduling toggle
  - Priority selection (low/medium/high)
  - Duration input
- ✅ **Settings Screen** (`app/(tabs)/settings.tsx`)
  - User profile options
  - Personality quiz retake
  - Preferences (notifications, work hours)
  - Google Calendar connection placeholder
  - Logout functionality (placeholder)

#### Core Business Logic (lib/)
- ✅ **types.ts** - Complete TypeScript definitions
  - PersonalityData with 6 core dimensions
  - Task with SMART/MANUAL support
  - CalendarEvent, TimeSlot, UserProfile
  - All component prop types
- ✅ **scheduling.ts** - Orchestrator for two-stage scheduling
  - `scheduleTask()` - Main entry point
  - Combines pre-filtering + AI ranking
  - Helper functions for top recommendation
- ✅ **scheduling-algorithm.ts** - Stage 1: Pre-filtering
  - Generates all possible time slots
  - ✅ Clamps look-ahead window to deadline
  - Filters busy times
  - Scores slots with 8 personality-based filters
  - Returns top 15-20 candidates
- ✅ **openai.ts** - Stage 2: AI ranking
  - `rankSlotsWithAI()` - Calls Edge Function
  - Fallback logic if AI fails
  - Placeholder for future implementation
- ✅ **supabase.ts** - Database client
  - Custom storage with SecureStore for tokens
  - AsyncStorage for non-sensitive data
  - Helper functions (getCurrentUser, signOut, etc.)
  - HTTPS verification
- ✅ **google-calendar.ts** - OAuth + Calendar sync
  - Placeholder for Google OAuth flow
  - Token storage with SecureStore
  - API helpers (fetch/create/update/delete events)
- ✅ **utils.ts** - Helper functions
  - Date/time formatting
  - Duration formatting
  - Time slot overlap detection
  - Debounce, truncate, getInitials

#### Database Schema
- ✅ **001_initial_schema.sql** - PostgreSQL migration
  - `user_profiles` table with personality_data (JSONB)
  - `tasks` table with SMART/MANUAL support
  - `calendar_events` table for Google Calendar sync
  - `user_patterns` table for analytics
  - Row-Level Security (RLS) policies on ALL tables
  - Indexes for performance
  - Auto-create user_profile on signup trigger
  - Constraints for data integrity

#### Theme & Constants
- ✅ **theme.ts** - React Native Paper configuration
  - Light theme with TailoredTime brand colors
  - Primary: #2563eb (blue)
  - Secondary: #8b5cf6 (purple)
  - Tertiary: #06b6d4 (cyan)
  - Custom colors for task priorities/statuses
  - Spacing and border radius scales

#### Configuration
- ✅ **app.json** - Expo configuration
  - Bundle ID: `com.adam.tailoredtime`
  - Android permissions (calendar, notifications, network)
  - iOS permission descriptions
  - Splash screen and icons configured
  - Notification plugin setup
- ✅ **.env.example** - Environment variables template
  - Supabase URL and anon key
  - Google OAuth client IDs
  - Security warnings (no OpenAI key in client!)
- ✅ **.gitignore** - Updated to ignore .env files

#### Documentation
- ✅ **DECISIONS.md** - Architecture & design decisions
  - Technology stack justifications
  - Two-tier scheduling algorithm explanation
  - 6 personality dimensions rationale
  - Security architecture decisions
  - What we excluded and why
- ✅ **SECURITY.md** - Security guidelines (pre-existing)
  - RLS requirements
  - OAuth PKCE implementation
  - Secure token storage
  - API key exposure prevention
- ✅ **SCHEDULING_ALGORITHM_DECISIONS.md** - Algorithm spec (pre-existing)
  - Two-stage hybrid approach
  - Pre-filtering rules (8 filters)
  - AI ranking prompt structure
  - User flows for SMART/MANUAL
- ✅ **README.md** - Setup and development guide
  - Quick start instructions
  - Project structure overview
  - API setup guides (for Week 2+)
  - Troubleshooting common issues
- ✅ **CHANGELOG.md** - This file!

### Changed
- Improved personality dimensions from 7 to 6:
  - Merged `deadline_tolerance` + `procrastination` → `deadline_style`
  - Removed `social_energy` (not actionable for personal scheduling)
  - Added `break_frequency` (critical for Pomodoro users)
  - Added `task_switching` (affects batching strategy)

### Fixed
- N/A (initial release)

### Security
- ✅ All database tables have RLS policies enabled
- ✅ Auth tokens stored in SecureStore (encrypted)
- ✅ No sensitive API keys in EXPO_PUBLIC_* variables
- ✅ OAuth configured with PKCE (no client secret needed)

---

## Development Timeline

### Week 1 (Jan 20, 2026) ✅ COMPLETE
- [x] Project initialization
- [x] Dependency installation
- [x] App structure with Expo Router
- [x] All placeholder screens with React Native Paper
- [x] Complete lib/ utilities
- [x] Database schema with RLS
- [x] Documentation (DECISIONS.md, README.md, CHANGELOG.md)

### Week 2 (Jan 27, 2026) 🚧 PLANNED
- [ ] Set up Supabase project
- [ ] Implement authentication (Google OAuth)
- [ ] Save personality data from onboarding
- [ ] Fetch and display tasks on home screen
- [ ] Create tasks in database

### Week 3 (Feb 3, 2026) 📋 PLANNED
- [ ] Google Calendar OAuth implementation
- [ ] Fetch calendar events
- [ ] Run pre-filtering algorithm
- [ ] Create OpenAI Edge Function
- [ ] Test SMART scheduling flow

### Week 4 (Feb 10, 2026) 📋 PLANNED
- [ ] Auto-reschedule background job
- [ ] Push notifications
- [ ] Settings functionality
- [ ] Bug fixes and polish
- [ ] TestFlight/Play Store internal testing

---

## Notes

**Platform:** Currently Android-focused. iOS will be added via EAS Build once validated.

**API Integration:** All API integrations (Supabase, Google Calendar, OpenAI) are placeholders in this release. They will be implemented in Weeks 2-4.

**Components:** Reusable components (TaskCard, TimeSlotPicker, PersonalitySlider) will be created as needed during implementation phase.

---

## Contributors

- **Adam Lubis** - Solo developer, founder

---

**Format:** [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
**Versioning:** [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
