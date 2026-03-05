# TailoredTime - Architecture & Design Decisions

**Last Updated:** January 20, 2026
**Status:** MVP Foundation Complete
**Version:** 1.0.0

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack Decisions](#technology-stack-decisions)
3. [Architecture Decisions](#architecture-decisions)
4. [Feature Decisions](#feature-decisions)
5. [Technical Implementation Decisions](#technical-implementation-decisions)
6. [Security Decisions](#security-decisions)
7. [What We Explicitly Excluded](#what-we-explicitly-excluded)
8. [Future Considerations](#future-considerations)

---

## Overview

**TailoredTime** is a mobile-first AI scheduling app that adapts to each user's personality and work style. The core differentiator is personality-based scheduling using 6 scientifically-backed dimensions combined with a two-stage hybrid algorithm (pre-filtering + AI ranking).

**Core Value Proposition:**
Like a tailored suit, TailoredTime is custom-fit to each user's personality. When scheduling, the app explains *why* it chose a specific time based on the user's unique traits, creating an "it knows me" moment.

---

## Technology Stack Decisions

### Frontend: React Native + Expo

**Why React Native:**
- ✅ Single codebase for Android + iOS
- ✅ Fast development with hot reload
- ✅ Large ecosystem of packages
- ✅ Good performance for our use case

**Why Expo (vs React Native CLI):**
- ✅ Faster setup (no Xcode/Android Studio config)
- ✅ OTA updates for quick bug fixes
- ✅ EAS Build for cloud builds (I have Windows, can build iOS later)
- ✅ Built-in tools (Auth, Notifications, SecureStore)
- ⚠️ Trade-off: Slightly larger app size, but acceptable for MVP

**Alternatives Considered:**
- ❌ Flutter: Dart learning curve, smaller ecosystem
- ❌ Native (Swift/Kotlin): 2x development time
- ❌ PWA: No offline support, poor UX on mobile

---

### Backend: Supabase

**Why Supabase (vs Firebase, AWS):**
- ✅ PostgreSQL (real database with SQL, not NoSQL)
- ✅ Row-Level Security (critical for multi-tenant apps)
- ✅ Edge Functions (Deno) for AI ranking
- ✅ Built-in auth with Google OAuth
- ✅ Real-time subscriptions (for future features)
- ✅ Generous free tier (50,000 monthly active users)

**Alternatives Considered:**
- ❌ Firebase: NoSQL harder to query, vendor lock-in
- ❌ AWS Amplify: Too complex for MVP, overkill
- ❌ Custom backend: Too much DevOps work, slows MVP

---

### UI Library: React Native Paper

**Why React Native Paper (vs others):**
- ✅ Material Design 3 (modern, clean)
- ✅ Built-in theming system
- ✅ Accessibility support out of the box
- ✅ Well-documented, active maintenance
- ✅ Works perfectly with Expo

**Alternatives Considered:**
- ❌ NativeBase: Heavier, slower
- ❌ React Native Elements: Outdated design
- ❌ Custom components: Too much work for MVP

---

### Calendar API: Google Calendar

**Why Google Calendar (vs others):**
- ✅ Most popular calendar (80%+ market share)
- ✅ OAuth 2.0 well-documented
- ✅ Free API with generous limits
- ✅ Works on all platforms

**Alternatives Considered:**
- ❌ Microsoft Outlook: Smaller user base, complex API
- ❌ Apple Calendar: iOS-only
- ❌ CalDAV: Too low-level, hard to implement

**Future:** May add Outlook in V2 if validated

---

### AI: OpenAI GPT-4o-mini

**Why GPT-4o-mini (vs other models):**
- ✅ Fast (200ms response time)
- ✅ Cheap ($0.15 per 1M input tokens)
- ✅ Good at structured output (JSON schema)
- ✅ Multimodal (can add image features later)

**Cost Analysis:**
- Per scheduling request: ~$0.00018
- 10,000 users × 10 tasks/week = $4.32/month
- Affordable for MVP

**Alternatives Considered:**
- ❌ Claude: More expensive, same quality
- ❌ Llama (self-hosted): DevOps overhead
- ❌ Gemini: Less reliable JSON output

---

## Architecture Decisions

### Two-Tier Scheduling Algorithm

**Why Hybrid (Algorithm + AI) vs Pure AI:**

**Problem:** Pure AI is slow and expensive for large option sets.

**Solution:** Two-stage hybrid approach
1. **Stage 1 (Algorithm):** Pre-filter 100+ slots → 15-20 viable candidates (fast, cheap)
2. **Stage 2 (AI):** Rank top 15-20 → Pick best 3 with reasons (slow, expensive, but limited scope)

**Benefits:**
- ✅ Fast (1-2 seconds total vs 5-10 seconds pure AI)
- ✅ Cost-effective (60% cheaper than pure AI)
- ✅ Explainable (algorithm provides baseline scoring)
- ✅ Fallback (if AI fails, use algorithm scores)

**See:** `SCHEDULING_ALGORITHM_DECISIONS.md` for full specification

---

### File-Based Routing (Expo Router)

**Why Expo Router (vs React Navigation):**
- ✅ Type-safe navigation
- ✅ File-based = easier to understand
- ✅ Deep linking out of the box
- ✅ SEO-friendly URLs (for future web version)

**Structure:**
```
app/
  (auth)/      # Route group (login, onboarding)
  (tabs)/      # Route group (home, add-task, settings)
  _layout.tsx  # Root layout with theme
  index.tsx    # Entry point (auth redirect)
```

---

### Client Architecture (Lib Structure)

**Why Modular Lib Folder:**

```
lib/
  types.ts                   # Single source of truth for types
  scheduling-algorithm.ts    # Stage 1: Pre-filtering
  openai.ts                  # Stage 2: AI ranking
  scheduling.ts              # Orchestrator (combines both stages)
  supabase.ts                # Database client with SecureStore
  google-calendar.ts         # OAuth + API calls
  utils.ts                   # Helper functions
```

**Benefits:**
- ✅ Separation of concerns
- ✅ Easy to test each module
- ✅ Clear data flow: `scheduling.ts` → `scheduling-algorithm.ts` → `openai.ts`
- ✅ Can refactor to modular types later if needed

---

## Feature Decisions

### Two Scheduling Methods (SMART vs MANUAL)

**Why Two Methods (not one, not three):**

**User Research:**
- Some users trust AI, some don't
- Some tasks are flexible (SMART), some are fixed (MANUAL)
- Three options = decision paralysis

**Implementation:**
- **SMART:** AI picks best time, show top 1 (then 2 alternatives if rejected)
- **MANUAL:** User picks from calendar, no AI involved

**UX Flow:**
```
SMART: Create task → AI thinks (1-2s) → "I picked Tuesday 2pm (95% match)" → Confirm/See Others
MANUAL: Create task → Calendar picker → Pick time → Done
```

**See:** `SCHEDULING_ALGORITHM_DECISIONS.md` for complete user flows

---

### 6 Personality Dimensions (Improved from 7)

**Why 6 (not 5, not 7, not 10):**

**Research-Backed:**
1. **Chronotype** (circadian rhythm) - Well-studied
2. **Focus Duration** (Pomodoro vs Deep Work) - Actionable
3. **Deadline Style** (early vs last-minute) - Affects scheduling urgency
4. **Break Frequency** (how often user needs breaks) - Critical for task chunking
5. **Task Switching** (single-task vs multi-task) - Affects batching strategy
6. **Structure Preference** (rigid vs fluid) - Affects auto-reschedule behavior

**Why We Removed:**
- ❌ Social Energy: Not actionable for personal scheduling
- ❌ Procrastination + Deadline Tolerance: Overlapping, merged into "Deadline Style"

**Why We Added:**
- ✅ Break Frequency: Critical for Pomodoro users
- ✅ Task Switching: Affects whether to batch similar tasks

**See:** `lib/types.ts` for PersonalityData interface

---

### Auto-Reschedule Feature

**Why Optional Auto-Reschedule (not forced):**

**User Control:**
- Some tasks MUST happen (meetings) → auto_reschedule = false
- Some tasks are flexible (personal work) → auto_reschedule = true

**Implementation:**
- Background job runs every hour (Supabase Edge Function + pg_cron)
- Detects missed tasks (status = scheduled, scheduled_start < now)
- If auto_reschedule = true → Find new slot → Update task → Notify user
- If auto_reschedule = false → Mark as overdue → Notify user to manually reschedule

**See:** `SCHEDULING_ALGORITHM_DECISIONS.md` for background job flow

---

### Android-First Strategy

**Why Android First (vs iOS first):**
- ✅ I have Windows PC (can build Android locally)
- ✅ Larger global market share (71% vs 28%)
- ✅ Easier to test (Expo Go works well on Android)
- ✅ Play Store easier than App Store (approval process)

**iOS Later:**
- Will use EAS Build (cloud builds) when validated
- Can test on borrowed iPhone or via TestFlight
- Apple Developer Program ($99/year) only when ready to publish

---

## Technical Implementation Decisions

### Database Schema

**Why These 4 Tables:**

1. **user_profiles** - Personality data + preferences
2. **tasks** - Core task data with SMART/MANUAL flag
3. **calendar_events** - Synced Google Calendar events (busy times)
4. **user_patterns** - Computed analytics (updated periodically)

**Why JSONB for Personality Data:**
- ✅ Flexible (can add new dimensions without migration)
- ✅ PostgreSQL has great JSONB support (indexes, queries)
- ✅ Easier to evolve schema during MVP phase

**Why Separate calendar_events Table:**
- ✅ Can sync/refresh without touching tasks
- ✅ Can query busy times efficiently
- ✅ One-way sync (Google Calendar is source of truth)

**See:** `supabase/migrations/001_initial_schema.sql`

---

### Row-Level Security (RLS)

**Why RLS (vs Application-Level Auth):**

**Security:**
- ✅ Enforced at database level (can't bypass)
- ✅ Prevents data leaks even if app code has bugs
- ✅ Works with Supabase client automatically

**All Tables Have:**
- Policies: SELECT, INSERT, UPDATE, DELETE
- Filter: `auth.uid() = user_id`
- Applied to: authenticated users only

**Critical:** See `SECURITY.md` for why this is essential (CVE-2025-48757 reference)

---

### Secure Token Storage

**Why SecureStore (vs AsyncStorage):**

**Security:**
- ✅ Hardware-backed encryption on supported devices
- ✅ Keychain/Keystore integration
- ✅ Never stored in plain text

**What Goes Where:**
- **SecureStore:** Auth tokens, Google OAuth tokens, refresh tokens
- **AsyncStorage:** Theme preference, last sync time, onboarding complete

**See:** `lib/supabase.ts` for custom storage implementation

---

### OAuth with PKCE

**Why PKCE (vs Client Secret):**

**Security:**
- ✅ Mobile apps are "public clients" (can't hide secrets)
- ✅ PKCE prevents authorization code interception
- ✅ Industry standard for mobile OAuth

**Implementation:**
- expo-auth-session has PKCE enabled by default
- No client secret needed
- State parameter for CSRF protection

**See:** `SECURITY.md` for full OAuth security requirements

---

## Security Decisions

### No OpenAI API Key in Client

**Why Edge Function Proxy:**

**Problem:** Any EXPO_PUBLIC_* variable is in app bundle (can be extracted)

**Solution:**
```
Mobile App → Supabase Edge Function → OpenAI API
           (anon key)              (service key)
```

**Benefits:**
- ✅ API key never exposed
- ✅ Can add rate limiting server-side
- ✅ Can log API usage
- ✅ Can swap AI provider without app update

**Cost:** Adds 100-200ms latency (acceptable)

**See:** `SECURITY.md` for full details

---

### No RAG for Context

**Why SQL Queries (vs Vector Database):**

**For MVP:**
- ✅ PostgreSQL queries are sufficient for context
- ✅ User has limited data (not millions of tasks)
- ✅ Simpler architecture, faster development

**What We Query:**
- Existing tasks on same day (task switching context)
- Recent task completion patterns (user_patterns table)
- Personality data (already structured)

**Future:** May add vector embeddings in V2 for semantic task grouping

---

## What We Explicitly Excluded

### V1 Scope (What's NOT in MVP)

**Features Excluded (for now):**
- ❌ Recurring tasks (complex scheduling logic)
- ❌ Multiple calendars (focus on Google only)
- ❌ Team/shared tasks (personal scheduling only)
- ❌ Outlook/Apple Calendar integration
- ❌ Habit tracking (different product vertical)
- ❌ Time blocking (different UX paradigm)
- ❌ Pomodoro timer (nice-to-have, not core)
- ❌ Task dependencies (adds complexity)
- ❌ Subtasks (nested tasks are complex)
- ❌ Dark mode (will add in V1.1)

**Reasons:**
1. Faster MVP validation
2. Simpler codebase (easier to maintain)
3. Can add incrementally based on user feedback

---

### Technical Debt We're OK With

**Acceptable for MVP:**
- ✅ No offline-first architecture (requires network)
- ✅ No caching layer (Supabase is fast enough)
- ✅ No analytics tracking (will add PostHog later)
- ✅ No error tracking (will add Sentry later)
- ✅ No unit tests yet (will add when validated)
- ✅ Placeholder sliders in onboarding (will improve UX later)

**Why This Is OK:**
- Faster iteration during validation phase
- Can refactor once we know what works
- Premature optimization wastes time

---

## Future Considerations

### V2 Features (If Validated)

**Month 3-6:**
- Recurring tasks (weekly meetings, daily exercise)
- Outlook Calendar integration
- Team scheduling (find time for 2+ people)
- Smart reschedule suggestions ("Move all Thursday tasks to Friday?")
- Machine learning from completion history
- Apple Calendar integration

**Month 6-12:**
- Web app (Expo for web)
- Desktop app (Electron)
- API for third-party integrations
- Zapier/IFTTT integration
- Premium tier (advanced features)

---

### Scaling Considerations

**Current Architecture Scales To:**
- 100,000 users easily
- 10M API requests/month
- $500/month OpenAI costs at 100K users

**What We'll Need Later:**
- CDN for assets (Cloudflare)
- Database read replicas (Supabase supports this)
- Redis caching for hot paths
- Better monitoring (Sentry + PostHog)

---

## Version History

**v1.0.0** - January 20, 2026
- Initial architecture decisions documented
- Foundation complete (app structure, database, lib utilities)
- Ready for Supabase/Google/OpenAI integration

---

## Maintainers

**Primary:** Adam Lubis
**Role:** Founder, Solo Developer
**Contact:** [Your email]

---

## References

- [SECURITY.md](./SECURITY.md) - Security requirements and guidelines
- [SCHEDULING_ALGORITHM_DECISIONS.md](./SCHEDULING_ALGORITHM_DECISIONS.md) - Scheduling algorithm specification
- [README.md](./README.md) - Setup and development guide
- [CHANGELOG.md](./CHANGELOG.md) - Version history

---

**Last Reviewed:** January 20, 2026
**Next Review Due:** February 20, 2026 (monthly)
