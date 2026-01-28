# TailoredTime

> Time management, tailored to you

**Status:** 🚧 MVP Foundation Complete
**Version:** 1.0.0
**Platform:** Android-first (iOS later via EAS Build)

---

## What is TailoredTime?

TailoredTime is a mobile-first AI scheduling app that adapts to your unique personality and work style. Unlike generic calendar apps, TailoredTime learns how YOU work best and schedules tasks at optimal times based on your:

- **Chronotype** (night owl vs early bird)
- **Focus Duration** (short sprints vs deep work blocks)
- **Deadline Style** (early starter vs deadline-driven)
- **Break Needs** (frequent breaks vs long sessions)
- **Task Switching** (single-task vs multi-task)
- **Schedule Flexibility** (rigid vs fluid)

**Core Value Proposition:**
When TailoredTime schedules a task, it explains *why*: "I picked Tuesday 7pm because YOU'RE a night owl and YOU prefer 2-hour blocks" - creating an "it knows me" moment.

---

## Current Status

### ✅ Completed (Foundation)

- [x] Full app structure with Expo Router
- [x] React Native Paper UI (all screens designed)
- [x] Authentication flow (Login → Onboarding → Home)
- [x] 6-dimension personality quiz
- [x] Bottom tab navigation (Home, Add Task, Settings)
- [x] Database schema with RLS policies
- [x] Two-stage scheduling algorithm (pre-filter + AI ranking)
- [x] TypeScript types for entire project
- [x] Security architecture (SecureStore, OAuth PKCE)

### 🚧 In Progress (Week 2-4)

- [ ] Supabase integration (auth, database)
- [ ] Google Calendar OAuth + sync
- [ ] OpenAI Edge Function for AI ranking
- [ ] Task creation with SMART/MANUAL scheduling
- [ ] Auto-reschedule background job
- [ ] Push notifications

### 📋 Planned (Post-MVP)

- [ ] Recurring tasks
- [ ] Outlook Calendar integration
- [ ] Team scheduling
- [ ] Analytics & insights
- [ ] iOS version

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | React Native + Expo | Cross-platform, fast development |
| **UI Library** | React Native Paper | Material Design 3, built-in theming |
| **Navigation** | Expo Router | File-based, type-safe routing |
| **Backend** | Supabase (PostgreSQL) | Real database with RLS, Edge Functions |
| **Auth** | Supabase Auth + Google OAuth | PKCE-enabled, secure mobile auth |
| **Calendar** | Google Calendar API | Most popular, OAuth 2.0 |
| **AI** | OpenAI GPT-4o-mini | Fast, cheap, good structured output |
| **Storage** | expo-secure-store | Hardware-backed encryption for tokens |
| **Offline** | @react-native-community/netinfo | Network detection |
| **Notifications** | expo-notifications | Push notifications |

---

## Quick Start

### Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- Git ([Download](https://git-scm.com/))
- Expo Go app on Android phone ([Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent))

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/tailoredtime.git
cd tailoredtime

# Install dependencies
npm install

# Start development server
npx expo start

# Scan QR code with Expo Go app
```

**Expected:** See login screen → Navigate to onboarding → Navigate to home with tabs

---

## Project Structure

```
tailoredtime/
├── app/                          # Expo Router screens
│   ├── (auth)/                   # Authentication flow
│   │   ├── login.tsx             # Google OAuth login
│   │   └── onboarding.tsx        # 6-slider personality quiz
│   ├── (tabs)/                   # Main app tabs
│   │   ├── home.tsx              # Calendar view
│   │   ├── add-task.tsx          # Create task
│   │   └── settings.tsx          # User preferences
│   ├── _layout.tsx               # Root layout (Paper theme)
│   └── index.tsx                 # Entry point (auth redirect)
│
├── lib/                          # Core business logic
│   ├── scheduling.ts             # Orchestrator (Stage 1 + 2)
│   ├── scheduling-algorithm.ts   # Stage 1: Pre-filtering
│   ├── openai.ts                 # Stage 2: AI ranking
│   ├── supabase.ts               # Database client
│   ├── google-calendar.ts        # OAuth + calendar sync
│   ├── types.ts                  # TypeScript interfaces
│   └── utils.ts                  # Helper functions
│
├── constants/
│   └── theme.ts                  # React Native Paper theme
│
├── supabase/migrations/
│   └── 001_initial_schema.sql    # Tables + RLS policies
│
├── .env.example                  # Environment variables template
├── DECISIONS.md                  # Architecture decisions
├── SECURITY.md                   # Security guidelines
└── SCHEDULING_ALGORITHM_DECISIONS.md  # Algorithm spec
```

---

## API Setup (Week 2+)

### Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Run migration: `supabase db push`
3. Copy API keys to `.env`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```

### Google Calendar

1. Create project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable Google Calendar API
3. Create OAuth credentials (Android)
4. Add to `.env`:
   ```
   EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=123456789-abc.apps.googleusercontent.com
   ```

### OpenAI

**⚠️ CRITICAL:** Never put API key in `.env` - use Edge Function!

1. Get API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create Edge Function: `supabase functions new rank-slots`
3. Set secret: `supabase secrets set OPENAI_API_KEY=sk-proj-...`
4. Deploy: `supabase functions deploy rank-slots`

---

## Development

### Running the App

```bash
# Start dev server
npx expo start

# Clear cache
npx expo start -c

# Type checking
npx tsc --noEmit
```

### Database Migrations

```bash
# Create migration
supabase migration new your_migration_name

# Apply migration
supabase db push

# Reset database
supabase db reset
```

### Building

```bash
# Android APK
eas build --platform android --profile preview

# Production AAB
eas build --platform android --profile production
```

---

## Documentation

- **[DECISIONS.md](./DECISIONS.md)** - Architecture decisions
- **[SECURITY.md](./SECURITY.md)** - Security requirements
- **[SCHEDULING_ALGORITHM_DECISIONS.md](./SCHEDULING_ALGORITHM_DECISIONS.md)** - Algorithm spec
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history

---

## Troubleshooting

**Module not found:**
```bash
rm -rf node_modules && npm install && npx expo start -c
```

**TypeScript errors:**
```bash
# Regenerate types by starting Expo
npx expo start
```

**Supabase connection fails:**
- Check `.env` file exists and has correct values
- Verify API keys in Supabase Dashboard

---

## Contact

**Developer:** Adam Lubis
**GitHub:** [@yourusername](https://github.com/yourusername)

---

**Last Updated:** January 20, 2026
**Version:** 1.0.0 (MVP Foundation)
