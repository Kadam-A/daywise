3# Security Guidelines for TailoredTime

**Last Updated:** January 18, 2026  
**App:** TailoredTime - AI Personal Scheduling App  
**Stack:** React Native/Expo, Supabase, Google Calendar API, OpenAI

---

## Table of Contents

1. [Critical Vulnerabilities](#critical-vulnerabilities)
2. [Important Best Practices](#important-best-practices)
3. [Security Checklist](#security-checklist)
4. [Code Examples](#code-examples)
5. [Testing Security](#testing-security)
6. [Incident Response](#incident-response)
7. [Resources](#resources)

---

## Critical Vulnerabilities

### 🔴 CRITICAL #1: Row-Level Security (RLS)

**Priority:** HIGHEST  
**Risk:** Data breach, unauthorized access to user data  
**CVE Reference:** CVE-2025-48757 (170+ apps exposed in January 2025)

#### The Problem

Supabase creates tables with RLS **disabled by default**. 83% of exposed Supabase databases involve RLS misconfigurations. Without RLS, anyone with your anon key can read ALL data in your database.

#### What You MUST Do

**Step 1: Enable RLS on EVERY table**

```sql
-- Run this for EVERY table you create
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_patterns ENABLE ROW LEVEL SECURITY;
```

**Step 2: Create policies for each table**

```sql
-- Example: tasks table policies

-- Users can view their own tasks
CREATE POLICY "Users can view own tasks"
ON tasks FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own tasks
CREATE POLICY "Users can insert own tasks"
ON tasks FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
CREATE POLICY "Users can update own tasks"
ON tasks FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Users can delete their own tasks
CREATE POLICY "Users can delete own tasks"
ON tasks FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
```

**Step 3: Add indexes for RLS performance**

```sql
-- RLS policies use these columns, so index them
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX idx_user_profiles_id ON user_profiles(id);
CREATE INDEX idx_user_patterns_user_id ON user_patterns(user_id);
```

Performance impact: 100x improvement on large tables with proper indexes.

#### Testing RLS

```sql
-- Test as anonymous user (should return 0 rows)
SET ROLE anon;
SELECT * FROM tasks;
-- Expected: 0 rows

-- Test as authenticated user (should return only their data)
SET ROLE authenticated;
SET request.jwt.claims.sub = 'test-user-uuid';
SELECT * FROM tasks;
-- Expected: Only rows where user_id = 'test-user-uuid'
```

#### Common RLS Mistakes to Avoid

- ❌ Enabling RLS but not creating policies (blocks ALL access)
- ❌ Using `TO public` instead of `TO authenticated` (exposes to anonymous users)
- ❌ Not using `auth.uid()` in policies (allows cross-user access)
- ❌ Using `user_metadata` in RLS policies (can be modified by users)
- ❌ Forgetting to add indexes on filtered columns

---

### 🔴 CRITICAL #2: API Key Exposure

**Priority:** HIGHEST  
**Risk:** Unauthorized API access, financial loss, data breach

#### The Problem

Any environment variable prefixed with `EXPO_PUBLIC_` is bundled into your JavaScript code and **visible in plain text** in your compiled application. Anyone can decompile your APK/IPA and extract these keys.

#### What You MUST Do

**❌ NEVER do this:**

```javascript
// .env file
EXPO_PUBLIC_OPENAI_API_KEY=sk-proj-...  // ❌ EXPOSED IN APP BUNDLE
EXPO_PUBLIC_SUPABASE_SERVICE_KEY=...    // ❌ EXPOSED, BYPASSES RLS
EXPO_PUBLIC_GOOGLE_CLIENT_SECRET=...    // ❌ EXPOSED
```

**✅ CORRECT approach:**

```javascript
// .env file - Only non-sensitive values
EXPO_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co  // ✅ OK (public)
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...                      // ✅ OK (protected by RLS)
EXPO_PUBLIC_GOOGLE_CLIENT_ID=...                          // ✅ OK (not secret)

// These should NEVER be in .env (server-side only):
# OPENAI_API_KEY=sk-...        # ❌ Don't put in .env at all
# SUPABASE_SERVICE_KEY=...     # ❌ Don't put in .env at all
```

**Architecture: Always use Edge Functions for sensitive API calls**

```
Mobile App ──(anon key)──> Supabase Edge Function ──(service key)──> OpenAI API
           (RLS protected)                        (server-side only)
```

#### Implementation

**In your mobile app:**

```typescript
// lib/openai.ts
import { supabase } from "./supabase";

// ✅ CORRECT: Call YOUR Edge Function, not OpenAI directly
export async function generateScheduleExplanation(data: {
  userProfile: any;
  timeSlots: any[];
  task: any;
}) {
  const { data: result, error } = await supabase.functions.invoke(
    "generate-explanation",
    { body: data },
  );

  if (error) throw error;
  return result;
}

// ❌ NEVER call OpenAI directly from mobile app
// const openai = new OpenAI({ apiKey: process.env.EXPO_PUBLIC_OPENAI_KEY });
```

**In your Supabase Edge Function:**

```typescript
// supabase/functions/generate-explanation/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { OpenAI } from "https://esm.sh/openai@4.20.1";

// ✅ CORRECT: OpenAI key stored server-side only
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")!, // Server environment variable
});

serve(async (req) => {
  // Verify user is authenticated
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data } = await req.json();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Based on user profile: ${JSON.stringify(data.userProfile)}...`,
      },
    ],
    max_tokens: 150,
  });

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
  });
});
```

**Setting Edge Function environment variables:**

```bash
# Via Supabase CLI
supabase secrets set OPENAI_API_KEY=sk-proj-...

# Or via Supabase Dashboard:
# Project Settings → Edge Functions → Add Secret
```

---

### 🔴 CRITICAL #3: OAuth Security (PKCE Required)

**Priority:** HIGH  
**Risk:** Authorization code interception, account takeover

#### The Problem

Mobile apps are "public clients" that cannot securely store client secrets. Without PKCE (Proof Key for Code Exchange), attackers can intercept authorization codes and exchange them for access tokens.

#### What You MUST Do

**✅ PKCE is enabled by default in expo-auth-session, but verify:**

```typescript
// lib/google-calendar.ts
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};

export function useGoogleAuth() {
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,
      scopes: ["https://www.googleapis.com/auth/calendar"],
      redirectUri: AuthSession.makeRedirectUri({
        scheme: "tailoredtime", // Your app scheme
      }),
      // ✅ CRITICAL: PKCE must be enabled
      usePKCE: true, // Explicitly verify this is true

      // ✅ CRITICAL: Use state parameter for CSRF protection
      state: generateRandomState(), // Implement this
    },
    discovery,
  );

  useEffect(() => {
    if (response?.type === "success") {
      // ✅ Verify state matches to prevent CSRF
      if (response.params.state !== request?.state) {
        console.error("State mismatch - possible CSRF attack");
        return;
      }

      // Continue with auth...
    }
  }, [response]);

  return { request, response, promptAsync };
}

// Helper function
function generateRandomState(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}
```

**Additional OAuth Best Practices:**

- ✅ Always use system browser (not WebView) - expo-auth-session does this
- ✅ Validate redirect URIs match exactly
- ✅ Use short-lived access tokens (1 hour max)
- ✅ Implement refresh token rotation
- ✅ Never log or expose tokens

---

### 🔴 CRITICAL #4: Secure Token Storage

**Priority:** HIGH  
**Risk:** Token theft, session hijacking

#### The Problem

AsyncStorage is **unencrypted** and stores data in plain text on the device. Any app with root access or physical device access can read AsyncStorage data.

#### What You MUST Do

**❌ NEVER store sensitive data in AsyncStorage:**

```typescript
// ❌ WRONG - tokens exposed in plain text
import AsyncStorage from "@react-native-async-storage/async-storage";

await AsyncStorage.setItem("access_token", token); // ❌ UNENCRYPTED
await AsyncStorage.setItem("refresh_token", token); // ❌ UNENCRYPTED
await AsyncStorage.setItem("google_token", token); // ❌ UNENCRYPTED
```

**✅ Use SecureStore for sensitive data:**

```typescript
// ✅ CORRECT - tokens encrypted
import * as SecureStore from "expo-secure-store";

// Store tokens securely (hardware-backed encryption on supported devices)
export async function saveToken(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.error("Error saving to SecureStore:", error);
    throw error;
  }
}

export async function getToken(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.error("Error reading from SecureStore:", error);
    return null;
  }
}

export async function deleteToken(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.error("Error deleting from SecureStore:", error);
  }
}

// Usage
await saveToken("supabase_access_token", session.access_token);
await saveToken("supabase_refresh_token", session.refresh_token);
await saveToken("google_access_token", googleToken);
```

**✅ AsyncStorage is fine for non-sensitive data:**

```typescript
// These are OK in AsyncStorage (not sensitive)
await AsyncStorage.setItem("theme_preference", "dark");
await AsyncStorage.setItem("last_sync_time", new Date().toISOString());
await AsyncStorage.setItem("onboarding_complete", "true");
await AsyncStorage.setItem("language", "en");
```

**Installation:**

```bash
npx expo install expo-secure-store
```

---

### 🔴 CRITICAL #5: Service Role Key - Never in Client

**Priority:** HIGHEST  
**Risk:** Complete database compromise, RLS bypass

#### The Problem

Service role keys **bypass ALL Row-Level Security policies** and grant full database access. If exposed in client code, attackers have complete control over your database.

#### What You MUST Do

**❌ NEVER use service role key in mobile app:**

```typescript
// ❌ WRONG - bypasses ALL security
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey, // ❌ CATASTROPHIC - bypasses RLS, full DB access
);
```

**✅ ONLY use anon key in mobile app:**

```typescript
// ✅ CORRECT - protected by RLS
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, // ✅ RLS enforced
);
```

**✅ Service role ONLY in Edge Functions:**

```typescript
// supabase/functions/admin-task/index.ts
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // ✅ Server-side only
);

// Use for admin operations that need to bypass RLS
await supabaseAdmin
  .from("tasks")
  .delete()
  .eq("status", "deleted")
  .lt("updated_at", oldDate);
```

---

### 🔴 CRITICAL #6: Deep Link Security

**Priority:** MEDIUM  
**Risk:** Token/data exposure through URL interception

#### The Problem

Deep links (tailoredtime://...) are visible in system logs, can be intercepted by other apps, and are stored in browser history. Never send sensitive data through deep links.

#### What You MUST Do

**❌ NEVER send sensitive data in deep links:**

```typescript
// ❌ WRONG - token exposed in URL
const resetLink = `tailoredtime://reset-password?token=${resetToken}`;

// ❌ WRONG - user data exposed
const link = `tailoredtime://profile?email=${email}&phone=${phone}`;
```

**✅ Send only non-sensitive IDs:**

```typescript
// ✅ CORRECT - send only request ID
const resetLink = `tailoredtime://reset-password?request_id=${uuid}`;

// In app, fetch actual token from server
const handleDeepLink = async (url: string) => {
  const { request_id } = parseUrl(url);

  // Fetch sensitive data server-side
  const { data } = await supabase
    .from("password_resets")
    .select("token, expires_at")
    .eq("request_id", request_id)
    .single();

  if (data && new Date(data.expires_at) > new Date()) {
    // Use token securely
    processPasswordReset(data.token);
  }
};
```

**Configure deep linking securely:**

```javascript
// app.json
{
  "expo": {
    "scheme": "tailoredtime",
    "ios": {
      "associatedDomains": ["applinks:tailoredtime.app"]  // ✅ Use Universal Links
    },
    "android": {
      "intentFilters": [{
        "action": "VIEW",
        "autoVerify": true,  // ✅ Use App Links
        "data": {
          "scheme": "https",
          "host": "tailoredtime.app"
        }
      }]
    }
  }
}
```

---

### 🔴 CRITICAL #7: Dependency Vulnerabilities

**Priority:** HIGH  
**Risk:** Known CVEs, RCE, data exposure

#### Recent Critical CVEs

**CVE-2025-11953:** React Native CLI RCE (CVSS 9.8)

- Affects: @react-native-community/cli versions 4.8.0 to 20.0.0-alpha.2
- Impact: Remote code execution on developer machines
- Fix: Update to version 20.0.0 or later

**CVE-2025-55182 (React2Shell):** React Server Components RCE

- Affects: React 19.0.0, 19.1.0-19.1.1, 19.2.0
- Impact: Remote code execution on servers using RSC
- Fix: Update to 19.0.1, 19.1.2, or 19.2.1
- Note: Expo apps using only client-side code are NOT affected

#### What You MUST Do

**Check for vulnerabilities regularly:**

```bash
# Check for known vulnerabilities
npm audit

# Fix automatically when possible
npm audit fix

# Check specific package version
npm list @react-native-community/cli-server-api

# Update Expo SDK and dependencies
npx expo install --fix
```

**Set up automated security scanning:**

```yaml
# .github/workflows/security.yml
name: Security Audit

on:
  schedule:
    - cron: "0 0 * * 0" # Weekly on Sunday
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run npm audit
        run: npm audit --audit-level=high
```

**Create a security update schedule:**

- Weekly: Run `npm audit` during development
- Monthly: Update all dependencies to latest stable
- Immediate: Apply critical security patches within 24 hours

---

## Important Best Practices

### 🟡 Input Validation & Sanitization

**Use Zod for runtime validation:**

```bash
npm install zod
```

```typescript
// lib/validation.ts
import { z } from "zod";

// Define schemas for all user inputs
export const taskSchema = z.object({
  title: z.string().min(1, "Title required").max(200, "Title too long"),
  duration_minutes: z.number().int().min(5).max(480),
  due_date: z.string().datetime(),
  priority: z.enum(["low", "medium", "high"]),
  scheduling_method: z.enum(["MANUAL", "SMART"]),
});

export const personalityDataSchema = z.object({
  chronotype: z.number().int().min(0).max(100),
  focus_style: z.number().int().min(0).max(100),
  deadline_tolerance: z.number().int().min(0).max(100),
  social_energy: z.number().int().min(0).max(100),
  structure_preference: z.number().int().min(0).max(100),
  procrastination: z.number().int().min(0).max(100),
  preferred_windows: z
    .array(
      z.object({
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .min(1)
    .max(5),
});

// Use in your code
export async function createTask(input: unknown) {
  try {
    // ✅ Validate before using
    const validated = taskSchema.parse(input);

    const { data, error } = await supabase.from("tasks").insert({
      ...validated,
      user_id: (await supabase.auth.getUser()).data.user?.id,
    });

    if (error) throw error;
    return data;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Handle validation errors
      console.error("Validation failed:", error.errors);
      throw new Error("Invalid input data");
    }
    throw error;
  }
}
```

---

### 🟡 HTTPS Only

```typescript
// lib/supabase.ts
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;

// ✅ Verify HTTPS
if (!supabaseUrl.startsWith("https://")) {
  throw new Error("Supabase URL must use HTTPS");
}

// ✅ All Supabase and OpenAI endpoints use HTTPS by default
// Never downgrade to HTTP
```

---

### 🟡 Rate Limiting

**Implement in Edge Functions:**

```typescript
// supabase/functions/_shared/rate-limit.ts
import { createClient } from "@supabase/supabase-js";

export async function checkRateLimit(
  userId: string,
  endpoint: string,
  limit: number = 50,
  windowMs: number = 3600000, // 1 hour
): Promise<boolean> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { count } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .gte("created_at", new Date(Date.now() - windowMs).toISOString());

  if (count && count >= limit) {
    return false; // Rate limit exceeded
  }

  // Log this request
  await supabase.from("api_usage").insert({
    user_id: userId,
    endpoint,
    created_at: new Date().toISOString(),
  });

  return true; // Under limit
}

// Usage in Edge Function
import { checkRateLimit } from "../_shared/rate-limit.ts";

serve(async (req) => {
  const userId = getUserIdFromRequest(req);

  if (!(await checkRateLimit(userId, "generate-explanation", 50))) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  // Continue...
});
```

**Create rate limit table:**

```sql
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_usage_user_endpoint ON api_usage(user_id, endpoint, created_at);

-- Auto-delete old records (optional)
CREATE OR REPLACE FUNCTION delete_old_api_usage()
RETURNS void AS $$
BEGIN
  DELETE FROM api_usage WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
```

---

### 🟡 Error Handling (Don't Leak Info)

```typescript
// lib/error-handler.ts

/**
 * ❌ WRONG - leaks internal details to user
 */
function badErrorHandling() {
  try {
    // Some operation
  } catch (error: any) {
    console.error(error); // Logs to console (OK)
    Alert.alert("Error", error.message); // ❌ Shows DB error to user
    Alert.alert("Error", JSON.stringify(error)); // ❌ Even worse
  }
}

/**
 * ✅ CORRECT - shows generic message, logs details internally
 */
export function handleError(error: unknown, context: string) {
  // Log full error for debugging (with context)
  console.error(`[${context}]`, error);

  // Optionally send to error tracking service
  if (process.env.NODE_ENV === "production") {
    // Sentry.captureException(error, { tags: { context } });
  }

  // Show user-friendly message (no internal details)
  let userMessage = "Something went wrong. Please try again.";

  // Only show specific messages for known, safe errors
  if (error instanceof z.ZodError) {
    userMessage = "Invalid input. Please check your data.";
  } else if (error && typeof error === "object" && "code" in error) {
    switch (error.code) {
      case "23505": // Unique violation
        userMessage = "This item already exists.";
        break;
      case "23503": // Foreign key violation
        userMessage = "Related item not found.";
        break;
      case "PGRST116": // Supabase RLS violation
        userMessage = "You do not have permission to perform this action.";
        break;
    }
  }

  Alert.alert("Error", userMessage);
}

// Usage
async function createTask(data: unknown) {
  try {
    const validated = taskSchema.parse(data);
    const result = await supabase.from("tasks").insert(validated);
    if (result.error) throw result.error;
    return result.data;
  } catch (error) {
    handleError(error, "createTask");
    throw error; // Re-throw if caller needs to handle it
  }
}
```

---

### 🟡 Logging Best Practices

```typescript
// lib/logger.ts

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  // ✅ Safe logging - no sensitive data
  info(message: string, data?: Record<string, any>) {
    console.log(`[${this.context}]`, message, this.sanitize(data));
  }

  error(message: string, error: unknown, data?: Record<string, any>) {
    console.error(`[${this.context}]`, message, error, this.sanitize(data));
  }

  // Remove sensitive fields before logging
  private sanitize(
    data?: Record<string, any>,
  ): Record<string, any> | undefined {
    if (!data) return undefined;

    const sensitive = ["password", "token", "secret", "key", "authorization"];
    const sanitized = { ...data };

    Object.keys(sanitized).forEach((key) => {
      if (sensitive.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = "[REDACTED]";
      }
    });

    return sanitized;
  }
}

// Usage
const logger = new Logger("TaskService");

async function createTask(data: any) {
  logger.info("Creating task", { title: data.title }); // ✅ Safe

  // ❌ NEVER log tokens
  // logger.info('Auth', { token: authToken });  // ❌ BAD

  try {
    const result = await supabase.from("tasks").insert(data);
    logger.info("Task created", { id: result.data?.id });
    return result;
  } catch (error) {
    logger.error("Failed to create task", error);
    throw error;
  }
}
```

---

## Security Checklist

### Pre-Development Checklist

- [ ] `.gitignore` includes `.env` files
- [ ] `.env.example` created with placeholder values (no real keys)
- [ ] Git history checked for accidentally committed secrets
- [ ] Security tools installed (Zod, SecureStore)

### Development Checklist

#### Database Security

- [ ] RLS enabled on ALL tables
- [ ] RLS policies created for each table (SELECT, INSERT, UPDATE, DELETE)
- [ ] RLS policies tested as `anon` role (should return 0 rows for user data)
- [ ] RLS policies tested as `authenticated` role (should return only user's data)
- [ ] Indexes added on columns used in RLS policies
- [ ] Service role key NEVER used in client code
- [ ] All policies use `TO authenticated` not `TO public`

#### API Key Security

- [ ] No `EXPO_PUBLIC_` variables contain sensitive keys
- [ ] OpenAI API key stored server-side only
- [ ] Google Calendar API uses OAuth (not API key)
- [ ] Service role key stored in Edge Function secrets only
- [ ] All sensitive API calls go through Edge Functions

#### Authentication & Authorization

- [ ] OAuth uses PKCE (verify `usePKCE: true`)
- [ ] OAuth uses state parameter for CSRF protection
- [ ] Tokens stored in SecureStore (not AsyncStorage)
- [ ] Refresh token rotation implemented
- [ ] Session timeout configured (reasonable duration)
- [ ] Logout clears all tokens from SecureStore

#### Input Validation

- [ ] Zod schemas defined for all user inputs
- [ ] All inputs validated before database operations
- [ ] SQL injection not possible (using Supabase client, not raw SQL)
- [ ] File uploads validated (type, size, content - if applicable)

#### Network Security

- [ ] All API calls use HTTPS
- [ ] Certificate pinning considered (optional for MVP)
- [ ] Rate limiting implemented on Edge Functions
- [ ] CORS configured correctly (if using custom domain)

#### Data Protection

- [ ] No sensitive data in deep links
- [ ] No sensitive data in AsyncStorage
- [ ] No sensitive data logged to console
- [ ] User data encrypted at rest (Supabase default)
- [ ] User data encrypted in transit (HTTPS)

#### Error Handling

- [ ] Generic error messages shown to users
- [ ] Detailed errors logged internally only
- [ ] Error tracking set up (Sentry or similar - optional)
- [ ] No stack traces exposed to users

#### Dependencies

- [ ] `npm audit` run and vulnerabilities fixed
- [ ] All dependencies up to date
- [ ] Expo SDK on latest stable version
- [ ] React Native CLI updated (if using)
- [ ] No deprecated packages in use

### Pre-Launch Checklist

#### Security Audit

- [ ] Full security review completed
- [ ] Penetration testing performed (if budget allows)
- [ ] RLS policies reviewed by second developer
- [ ] Code review focused on security completed
- [ ] All TODOs related to security resolved

#### Configuration

- [ ] Production environment variables set correctly
- [ ] Development/staging keys different from production
- [ ] API keys rotated after testing phase
- [ ] Service role key never exposed in logs or errors
- [ ] App store security settings configured

#### Documentation

- [ ] SECURITY.md added to repository
- [ ] Security incident response plan documented
- [ ] Team trained on security best practices
- [ ] API documentation includes security notes
- [ ] README includes security setup instructions

#### Compliance (if applicable)

- [ ] Privacy policy published
- [ ] Terms of service published
- [ ] GDPR compliance reviewed (if EU users)
- [ ] CCPA compliance reviewed (if California users)
- [ ] Data retention policy implemented

### Post-Launch Checklist

#### Monitoring

- [ ] Error tracking active (Sentry or similar)
- [ ] Database query performance monitored
- [ ] API usage monitored for abuse
- [ ] Failed login attempts monitored
- [ ] Rate limit violations logged

#### Maintenance Schedule

- [ ] Weekly: Run `npm audit` and fix vulnerabilities
- [ ] Monthly: Update all dependencies to latest stable
- [ ] Quarterly: Review and update RLS policies
- [ ] Quarterly: Security audit of new features
- [ ] Yearly: Rotate API keys (if applicable)

#### Incident Response

- [ ] Security incident response plan tested
- [ ] Team knows how to report security issues
- [ ] Contact information for security reports published
- [ ] Backup and recovery procedures tested
- [ ] Data breach notification process documented

---

## Code Examples

### Complete Secure Setup Example

```typescript
// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Verify HTTPS
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
if (!supabaseUrl.startsWith("https://")) {
  throw new Error("Supabase URL must use HTTPS");
}

// ✅ Use anon key (protected by RLS)
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Custom storage implementation using SecureStore for tokens
const secureStorage = {
  getItem: async (key: string) => {
    // Use SecureStore for auth tokens
    if (key.includes("auth-token")) {
      return await SecureStore.getItemAsync(key);
    }
    // Use AsyncStorage for non-sensitive data
    return await AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (key.includes("auth-token")) {
      await SecureStore.setItemAsync(key, value);
    } else {
      await AsyncStorage.setItem(key, value);
    }
  },
  removeItem: async (key: string) => {
    if (key.includes("auth-token")) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ✅ Helper functions with error handling
export async function getCurrentUser() {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  } catch (error) {
    console.error("[getCurrentUser]", error);
    return null;
  }
}

export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    // Clear any additional secure storage
    await SecureStore.deleteItemAsync("google_access_token");
  } catch (error) {
    console.error("[signOut]", error);
    throw error;
  }
}
```

### Secure Task Creation Example

```typescript
// lib/tasks.ts
import { supabase } from "./supabase";
import { taskSchema } from "./validation";
import { handleError } from "./error-handler";

export async function createTask(input: unknown) {
  try {
    // 1. Validate input
    const validated = taskSchema.parse(input);

    // 2. Get current user
    const user = await supabase.auth.getUser();
    if (!user.data.user) {
      throw new Error("User not authenticated");
    }

    // 3. Insert task (RLS ensures user_id matches auth.uid())
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        ...validated,
        user_id: user.data.user.id, // Explicitly set user_id
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    handleError(error, "createTask");
    throw error;
  }
}

export async function updateTask(taskId: string, updates: unknown) {
  try {
    // 1. Validate input
    const validated = taskSchema.partial().parse(updates);

    // 2. Update (RLS ensures user can only update their own tasks)
    const { data, error } = await supabase
      .from("tasks")
      .update({
        ...validated,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .select()
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    handleError(error, "updateTask");
    throw error;
  }
}

export async function deleteTask(taskId: string) {
  try {
    // RLS ensures user can only delete their own tasks
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);

    if (error) throw error;
  } catch (error) {
    handleError(error, "deleteTask");
    throw error;
  }
}
```

### Secure Edge Function Example

```typescript
// supabase/functions/generate-explanation/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpenAI } from "https://esm.sh/openai@4.20.1";

// Rate limiting helper
async function checkRateLimit(userId: string): Promise<boolean> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count } = await supabase
    .from("api_usage")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("endpoint", "generate-explanation")
    .gte("created_at", oneHourAgo);

  if (count && count >= 50) return false;

  await supabase.from("api_usage").insert({
    user_id: userId,
    endpoint: "generate-explanation",
  });

  return true;
}

serve(async (req) => {
  try {
    // 1. Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Get user from JWT
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 3. Check rate limit
    if (!(await checkRateLimit(user.id))) {
      return new Response("Rate limit exceeded", { status: 429 });
    }

    // 4. Parse request
    const { userProfile, timeSlots, task } = await req.json();

    // 5. Call OpenAI (API key server-side only)
    const openai = new OpenAI({
      apiKey: Deno.env.get("OPENAI_API_KEY")!,
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Generate scheduling explanation...`,
        },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    return new Response(
      JSON.stringify({ explanation: response.choices[0].message.content }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in generate-explanation:", error);
    return new Response("Internal server error", { status: 500 });
  }
});
```

---

## Testing Security

### Manual Testing

**1. Test RLS Policies**

```sql
-- In Supabase SQL Editor

-- Test 1: Anonymous user should see nothing
SET ROLE anon;
SELECT * FROM tasks;  -- Should return 0 rows

-- Test 2: Authenticated user sees only their data
SET ROLE authenticated;
SET request.jwt.claims.sub = 'user-uuid-1';
SELECT * FROM tasks;  -- Should return only user-uuid-1's tasks

-- Test 3: Try to insert another user's data (should fail)
INSERT INTO tasks (user_id, title)
VALUES ('user-uuid-2', 'Test');  -- Should fail RLS check

-- Test 4: Try to update another user's task (should fail)
UPDATE tasks
SET title = 'Hacked'
WHERE user_id = 'user-uuid-2';  -- Should update 0 rows

-- Reset
RESET ROLE;
```

**2. Test Token Storage**

```typescript
// Test that tokens are in SecureStore, not AsyncStorage
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

async function testTokenStorage() {
  // Should be in SecureStore
  const token = await SecureStore.getItemAsync("supabase_access_token");
  console.log("Token in SecureStore:", !!token); // Should be true

  // Should NOT be in AsyncStorage
  const asyncToken = await AsyncStorage.getItem("supabase_access_token");
  console.log("Token in AsyncStorage:", !!asyncToken); // Should be false
}
```

**3. Test Rate Limiting**

```typescript
// Make 51 requests in quick succession
async function testRateLimit() {
  const results = [];

  for (let i = 0; i < 51; i++) {
    const response = await supabase.functions.invoke("generate-explanation", {
      body: { test: true },
    });
    results.push(response.status);
  }

  // First 50 should succeed (200), 51st should fail (429)
  console.log("Last response:", results[50]); // Should be 429
}
```

### Automated Testing

**Security Test Suite**

```typescript
// __tests__/security.test.ts
import { supabase } from "../lib/supabase";

describe("Security Tests", () => {
  describe("RLS Policies", () => {
    it("should prevent access to other users data", async () => {
      // Sign in as user 1
      await supabase.auth.signInWithPassword({
        email: "user1@test.com",
        password: "password123",
      });

      // Try to access user 2's data
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", "user-2-uuid");

      // Should return 0 rows (blocked by RLS)
      expect(data).toHaveLength(0);
    });

    it("should allow users to access their own data", async () => {
      const { data: user } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user?.user?.id);

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe("Input Validation", () => {
    it("should reject invalid task data", () => {
      const invalidData = {
        title: "", // Too short
        duration_minutes: 1000, // Too long
      };

      expect(() => taskSchema.parse(invalidData)).toThrow();
    });

    it("should accept valid task data", () => {
      const validData = {
        title: "Valid Task",
        duration_minutes: 60,
        due_date: new Date().toISOString(),
        priority: "medium",
        scheduling_method: "SMART",
      };

      expect(() => taskSchema.parse(validData)).not.toThrow();
    });
  });
});
```

---

## Incident Response

### If API Key is Exposed

1. **Immediate Actions (within 1 hour)**
   - [ ] Rotate the exposed key immediately
   - [ ] Check API usage logs for unauthorized access
   - [ ] Revoke all active sessions if auth tokens exposed
   - [ ] Notify team members

2. **Investigation (within 24 hours)**
   - [ ] Review git history to find when key was committed
   - [ ] Check if key was pushed to public repository
   - [ ] Review audit logs for suspicious activity
   - [ ] Document timeline of exposure

3. **Remediation**
   - [ ] Update application with new keys
   - [ ] Deploy updated version
   - [ ] Add key to .gitignore if not already
   - [ ] Use git-filter-repo to remove from history if needed
   - [ ] Set up alerts for future key exposure

4. **Prevention**
   - [ ] Implement pre-commit hooks to scan for secrets
   - [ ] Train team on security best practices
   - [ ] Review and update security documentation

### If Data Breach Occurs

1. **Immediate Actions**
   - [ ] Isolate affected systems
   - [ ] Revoke compromised access tokens
   - [ ] Enable additional logging
   - [ ] Notify security team/leadership

2. **Assessment**
   - [ ] Identify scope of breach (which users, what data)
   - [ ] Determine attack vector
   - [ ] Document timeline
   - [ ] Preserve evidence for investigation

3. **User Notification**
   - [ ] Notify affected users within 72 hours (GDPR requirement)
   - [ ] Provide clear information about what data was accessed
   - [ ] Offer remediation steps (password reset, etc.)
   - [ ] Set up support channel for user questions

4. **Regulatory Compliance**
   - [ ] Report to relevant authorities if required
   - [ ] Document breach and response for compliance
   - [ ] Work with legal team on obligations

5. **Post-Incident**
   - [ ] Conduct full security audit
   - [ ] Implement additional security measures
   - [ ] Update incident response plan
   - [ ] Share lessons learned with team

### Reporting Security Issues

**For Users:**

- Email: security@tailoredtime.app
- Include: Description of issue, steps to reproduce, impact

**For Developers:**

- Create private GitHub issue
- Tag as "security"
- Do not disclose publicly until fixed

---

## Resources

### Official Documentation

- **Supabase Security:** https://supabase.com/docs/guides/database/postgres/row-level-security
- **Expo Security:** https://docs.expo.dev/guides/security/
- **React Native Security:** https://reactnative.dev/docs/security
- **OAuth 2.1:** https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1

### Security Standards

- **OWASP Mobile Top 10:** https://owasp.org/www-project-mobile-top-10/
- **OWASP API Security:** https://owasp.org/www-project-api-security/
- **CWE Top 25:** https://cwe.mitre.org/top25/

### Tools

- **npm audit:** Built into npm, checks for known vulnerabilities
- **Snyk:** https://snyk.io - Automated security scanning
- **OWASP ZAP:** https://www.zaproxy.org - Security testing tool
- **SecureStore:** https://docs.expo.dev/versions/latest/sdk/securestore/

### Training

- **Supabase Auth Deep Dive:** https://supabase.com/docs/guides/auth
- **Mobile App Security Course:** https://www.udemy.com/topic/mobile-app-security/
- **OWASP Mobile Security:** https://mas.owasp.org/

---

## Version History

**v1.0.0** - January 18, 2026

- Initial security guidelines created
- Covers all critical vulnerabilities for TailoredTime
- Based on 2025/2026 security research

---

## Notes for Developers

**This document should be:**

- ✅ Read by all developers before starting work
- ✅ Referenced during code reviews
- ✅ Updated when new security issues are discovered
- ✅ Reviewed quarterly for accuracy

**When adding new features:**

1. Review relevant sections of this guide
2. Run security checklist
3. Test RLS policies if touching database
4. Update documentation if adding new security considerations

**Remember:**

- Security is everyone's responsibility
- When in doubt, ask for security review
- Better to over-engineer security than under-engineer it
- Users trust us with their data - protect it

---

**Last reviewed:** January 18, 2026  
**Next review due:** April 18, 2026  
**Maintained by:** Development Team  
**Contact:** security@tailoredtime.app
