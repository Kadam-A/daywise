/**
 * DayWise - Google Calendar Integration
 *
 * Handles OAuth 2.0 authentication and calendar sync with Google Calendar API.
 * Uses PKCE for secure mobile OAuth flow.
 *
 * SECURITY: See SECURITY.md "CRITICAL #3: OAuth Security (PKCE Required)"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { Platform, Linking } from "react-native";
import { GoogleCalendarTokens, GoogleCalendarEvent, CalendarEvent } from "./types";
import { supabase } from "./supabase";
import { trackCalendarSynced, trackCalendarSyncFailed } from "./analytics";

// HTTPS redirect target — Supabase function bounces back to daywise:// scheme.
// Required because Google blocks custom URI schemes for sensitive scopes on Web clients.
const OAUTH_REDIRECT_URI = "https://rkhjkkneadmfaacqcoth.supabase.co/functions/v1/google-oauth-redirect";

// Google OAuth endpoints
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// OAuth scopes needed
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

// Always use Web client — Android clients block custom URI schemes with sensitive scopes.
function getClientId(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || "";
}

function getClientSecret(): string | undefined {
  return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_WEB;
}

// Storage keys
const STORAGE_KEYS = {
  accessToken: "google_access_token",
  refreshToken: "google_refresh_token",
  tokenExpiry: "google_token_expiry",
  lastSyncTime: "google_last_sync",
  pendingCalendarOps: "google_pending_calendar_ops",
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
};

/**
 * Retry a function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  const baseDelay = options.baseDelay ?? RETRY_CONFIG.baseDelay;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on permanent errors (auth, permission, malformed request)
      if (lastError.message.includes("Not connected") ||
          lastError.message.includes("Session expired") ||
          lastError.message.includes("401") ||
          lastError.message.includes("Bad Request") ||
          lastError.message.includes("400") ||
          lastError.message.includes("organizer") ||
          lastError.message.includes("can't be rescheduled")) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), RETRY_CONFIG.maxDelay);
        console.log(`[Calendar] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Calendar operation result type
 */
export interface CalendarOperationResult {
  success: boolean;
  eventId?: string;
  error?: string;
  needsRetry?: boolean;
}

/**
 * Hook for Google Calendar OAuth authentication
 * Uses PKCE via AuthRequest + WebBrowser.openAuthSessionAsync.
 * Flow: app → Google (HTTPS) → Supabase redirect function → daywise:// deep link → token exchange
 */
export function useGoogleCalendarAuth() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  // Holds the AuthRequest between connect() and token exchange so codeVerifier is accessible
  const authRequestRef = useRef<AuthSession.AuthRequest | null>(null);

  const clientId = getClientId();
  const clientSecret = getClientSecret();

  useEffect(() => {
    if (__DEV__) {
      console.log("[GoogleCalendar] Client ID:", clientId ? "SET" : "MISSING!");
      console.log("[GoogleCalendar] Client secret:", clientSecret ? "SET" : "MISSING!");
      console.log("[GoogleCalendar] Redirect URI:", OAUTH_REDIRECT_URI);
    }
    checkConnectionStatus();
  }, []);

  // Re-check connection status when the screen comes back into focus,
  // so the UI updates immediately after returning from the OAuth flow.
  useFocusEffect(
    useCallback(() => {
      checkConnectionStatus();
    }, [])
  );

  const checkConnectionStatus = async () => {
    try {
      setIsLoading(true);
      console.log("[GoogleCalendar] Checking connection status...");
      const tokens = await getGoogleTokens();
      const connected = !!tokens;
      console.log("[GoogleCalendar] Connected:", connected, tokens ? `| token expires: ${new Date(tokens.expiry_date).toISOString()}` : "");
      setIsConnected(connected);

      const lastSync = await SecureStore.getItemAsync(STORAGE_KEYS.lastSyncTime);
      if (lastSync) {
        setLastSyncTime(new Date(parseInt(lastSync)));
      }
    } catch (error) {
      console.error("[GoogleCalendar] checkConnectionStatus error:", error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const exchangeCodeForTokens = async (code: string, codeVerifier: string) => {
    try {
      setIsLoading(true);
      console.log("[GoogleCalendar] Exchanging auth code for tokens...");
      console.log("[GoogleCalendar] Code (first 8 chars):", code.slice(0, 8) + "...");
      console.log("[GoogleCalendar] Redirect URI:", OAUTH_REDIRECT_URI);
      console.log("[GoogleCalendar] Client ID:", clientId ? clientId.slice(0, 20) + "..." : "MISSING");
      console.log("[GoogleCalendar] Code verifier present:", !!codeVerifier);
      console.log("[GoogleCalendar] Client secret:", clientSecret ? "SET" : "MISSING");

      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId,
          clientSecret,
          code,
          redirectUri: OAUTH_REDIRECT_URI,
          extraParams: { code_verifier: codeVerifier },
        },
        discovery
      );

      console.log("[GoogleCalendar] Token exchange success");
      console.log("[GoogleCalendar] Has access token:", !!tokenResponse.accessToken);
      console.log("[GoogleCalendar] Has refresh token:", !!tokenResponse.refreshToken);
      console.log("[GoogleCalendar] Expires in (s):", tokenResponse.expiresIn);

      const tokens: GoogleCalendarTokens = {
        access_token: tokenResponse.accessToken,
        refresh_token: tokenResponse.refreshToken || "",
        expiry_date: tokenResponse.expiresIn
          ? Date.now() + tokenResponse.expiresIn * 1000
          : Date.now() + 3600 * 1000,
        token_type: tokenResponse.tokenType || "Bearer",
        scope: SCOPES.join(" "),
      };

      if (!tokens.refresh_token) {
        console.warn("[GoogleCalendar] No refresh token — user may need to re-consent next time");
      }

      await saveGoogleTokens(tokens);
      setIsConnected(true);
      console.log("[GoogleCalendar] Tokens saved, starting calendar sync...");

      await syncCalendarEventsInternal();
      console.log("[GoogleCalendar] Successfully connected to Google Calendar");
    } catch (error: any) {
      console.error("[GoogleCalendar] Token exchange FAILED");
      console.error("[GoogleCalendar] Error message:", error?.message);
      console.error("[GoogleCalendar] Error detail:", JSON.stringify(error));
    } finally {
      setIsLoading(false);
    }
  };

  const connect = useCallback(async () => {
    try {
      console.log("[GoogleCalendar] connect() called");
      console.log("[GoogleCalendar] Client ID:", clientId ? "SET" : "MISSING");

      // Build auth request — codeVerifier is populated after makeAuthUrlAsync resolves
      const authRequest = new AuthSession.AuthRequest({
        clientId,
        scopes: SCOPES,
        redirectUri: OAUTH_REDIRECT_URI,
        usePKCE: true,
        extraParams: {
          access_type: "offline",
          prompt: "consent",
        },
      });
      authRequestRef.current = authRequest;

      const authUrl = await authRequest.makeAuthUrlAsync(discovery);
      console.log("[GoogleCalendar] Auth URL built, code verifier ready:", !!authRequest.codeVerifier);
      console.log("[GoogleCalendar] Opening OAuth browser...");

      // createTask: false reduces the Android race condition where AppState fires
      // before the Linking redirect event, causing a false 'dismiss' result
      const result = await WebBrowser.openAuthSessionAsync(authUrl, "daywise://", {
        createTask: false,
      });

      console.log("[GoogleCalendar] Browser result type:", result.type);

      if (result.type === "success") {
        console.log("[GoogleCalendar] OAuth success — URL:", result.url);
        const urlObj = new URL(result.url);
        const code = urlObj.searchParams.get("code");
        const error = urlObj.searchParams.get("error");

        if (error) {
          console.error("[GoogleCalendar] OAuth error param:", error);
          return;
        }

        if (!code) {
          console.error("[GoogleCalendar] No code in redirect URL");
          return;
        }

        if (!authRequest.codeVerifier) {
          console.error("[GoogleCalendar] Code verifier missing after makeAuthUrlAsync");
          return;
        }

        await exchangeCodeForTokens(code, authRequest.codeVerifier);
      } else if (result.type === "cancel" || result.type === "dismiss") {
        console.log("[GoogleCalendar] OAuth cancelled/dismissed by user");
      }
    } catch (error: any) {
      console.error("[GoogleCalendar] connect() error:", error?.message);
      setIsLoading(false);
    }
  }, [clientId, clientSecret]);

  const disconnect = useCallback(async (deleteEvents = true) => {
    try {
      setIsLoading(true);
      await disconnectGoogleCalendar(deleteEvents);
      setIsConnected(false);
      setLastSyncTime(null);
    } catch (error) {
      console.error("[useGoogleCalendarAuth] Disconnect error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const syncCalendarEventsInternal = async () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    await fetchGoogleCalendarEvents(startDate, endDate);
    const now = Date.now();
    await SecureStore.setItemAsync(STORAGE_KEYS.lastSyncTime, now.toString());
    setLastSyncTime(new Date(now));
    console.log("[useGoogleCalendarAuth] Calendar sync complete");
  };

  const syncCalendarEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      await syncCalendarEventsInternal();
    } catch (error) {
      console.error("[useGoogleCalendarAuth] Sync error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isConnected,
    isLoading,
    lastSyncTime,
    connect,
    disconnect,
    syncCalendarEvents,
    isReady: true,
  };
}

/**
 * Save Google Calendar tokens securely
 */
export async function saveGoogleTokens(tokens: GoogleCalendarTokens): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEYS.accessToken, tokens.access_token);
    await SecureStore.setItemAsync(STORAGE_KEYS.refreshToken, tokens.refresh_token);
    await SecureStore.setItemAsync(STORAGE_KEYS.tokenExpiry, tokens.expiry_date.toString());
    console.log("[saveGoogleTokens] Tokens saved securely");
  } catch (error) {
    console.error("[saveGoogleTokens]", error);
    throw error;
  }
}

/**
 * Get stored Google Calendar tokens
 */
export async function getGoogleTokens(): Promise<GoogleCalendarTokens | null> {
  try {
    const access_token = await SecureStore.getItemAsync(STORAGE_KEYS.accessToken);
    const refresh_token = await SecureStore.getItemAsync(STORAGE_KEYS.refreshToken);
    const expiry = await SecureStore.getItemAsync(STORAGE_KEYS.tokenExpiry);

    if (!access_token || !refresh_token || !expiry) {
      return null;
    }

    return {
      access_token,
      refresh_token,
      expiry_date: parseInt(expiry),
      token_type: "Bearer",
      scope: SCOPES.join(" "),
    };
  } catch (error) {
    console.error("[getGoogleTokens]", error);
    return null;
  }
}

/**
 * Check if Google Calendar is connected
 */
export async function isGoogleCalendarConnected(): Promise<boolean> {
  const tokens = await getGoogleTokens();
  return !!tokens;
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidAccessToken(): Promise<string> {
  const tokens = await getGoogleTokens();
  if (!tokens) {
    throw new Error("Not connected to Google Calendar");
  }

  // Check if token is expired (with 5-minute buffer)
  const isExpired = tokens.expiry_date < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    return tokens.access_token;
  }

  // Refresh the token
  console.log("[getValidAccessToken] Token expired, refreshing...");

  try {
    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const tokenResponse = await AuthSession.refreshAsync(
      {
        clientId,
        clientSecret, // Required for web
        refreshToken: tokens.refresh_token,
      },
      discovery
    );

    const newTokens: GoogleCalendarTokens = {
      access_token: tokenResponse.accessToken,
      refresh_token: tokenResponse.refreshToken || tokens.refresh_token,
      expiry_date: tokenResponse.expiresIn
        ? Date.now() + tokenResponse.expiresIn * 1000
        : Date.now() + 3600 * 1000,
      token_type: tokenResponse.tokenType || "Bearer",
      scope: SCOPES.join(" "),
    };

    await saveGoogleTokens(newTokens);
    console.log("[getValidAccessToken] Token refreshed successfully");

    return newTokens.access_token;
  } catch (error) {
    console.error("[getValidAccessToken] Refresh failed:", error);
    // Clear tokens if refresh fails - user needs to reconnect
    await disconnectGoogleCalendar();
    throw new Error("Session expired. Please reconnect Google Calendar.");
  }
}

/**
 * Fetch calendar events from Google Calendar and sync to Supabase
 */
export async function fetchGoogleCalendarEvents(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  try {
    const accessToken = await getValidAccessToken();

    const timeMin = startDate.toISOString();
    const timeMax = endDate.toISOString();

    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${encodeURIComponent(timeMin)}&` +
      `timeMax=${encodeURIComponent(timeMax)}&` +
      `singleEvents=true&` +
      `orderBy=startTime&` +
      `maxResults=250`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[fetchGoogleCalendarEvents] API error:", error);
      throw new Error(error.error?.message || "Failed to fetch calendar events");
    }

    const data = await response.json();
    const googleEvents: GoogleCalendarEvent[] = data.items || [];

    // Filter out cancelled events and map to our format
    const calendarEvents: Omit<CalendarEvent, "id">[] = googleEvents
      .filter((event) => event.status !== "cancelled")
      .map((event) => ({
        user_id: "", // Will be set by RLS
        google_event_id: event.id,
        title: event.summary || "Busy",
        start_time: event.start.dateTime || `${event.start.date}T00:00:00Z`,
        end_time: event.end.dateTime || `${event.end.date}T23:59:59Z`,
        all_day: !event.start.dateTime,
        synced_at: new Date().toISOString(),
      }));

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Not authenticated");
    }

    // Exclude events already owned by app tasks (they show as tasks in the UI,
    // so importing them as calendar_events would create visible duplicates).
    const { data: taskEventRows } = await supabase
      .from("tasks")
      .select("google_event_id")
      .eq("user_id", user.id)
      .not("google_event_id", "is", null);

    const taskEventIds = new Set((taskEventRows || []).map((t: any) => t.google_event_id));
    const externalEvents = calendarEvents.filter((e) => !taskEventIds.has(e.google_event_id));

    // Delete-then-upsert within the sync window so orphaned rows (events deleted
    // from Google) are automatically removed on every full sync.
    await supabase
      .from("calendar_events")
      .delete()
      .eq("user_id", user.id)
      .gte("start_time", startDate.toISOString())
      .lte("start_time", endDate.toISOString());

    // Upsert external events — delete above handles orphans, upsert handles
    // any edge cases where start_time falls just outside the delete window.
    for (const event of externalEvents) {
      const { error } = await supabase
        .from("calendar_events")
        .upsert(
          { ...event, user_id: user.id },
          { onConflict: "user_id,google_event_id" }
        );

      if (error) {
        console.error("[fetchGoogleCalendarEvents] Upsert error:", error);
      }
    }

    // Fetch all synced events from database
    const { data: dbEvents, error: fetchError } = await supabase
      .from("calendar_events")
      .select("*")
      .gte("start_time", startDate.toISOString())
      .lte("end_time", endDate.toISOString())
      .order("start_time", { ascending: true });

    if (fetchError) {
      console.error("[fetchGoogleCalendarEvents] DB fetch error:", fetchError);
      throw fetchError;
    }

    console.log(`[fetchGoogleCalendarEvents] Synced ${calendarEvents.length} events`);
    trackCalendarSynced(calendarEvents.length); // fire-and-forget
    return dbEvents || [];
  } catch (error) {
    console.error("[fetchGoogleCalendarEvents]", error);
    trackCalendarSyncFailed(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Create an event in Google Calendar for a scheduled task
 */
export async function createGoogleCalendarEvent(
  title: string,
  description: string | undefined,
  startTime: string,
  endTime: string
): Promise<string> {
  try {
    const accessToken = await getValidAccessToken();

    const event = {
      summary: title,
      description: description || `Task scheduled via DayWise`,
      start: { dateTime: startTime },
      end: { dateTime: endTime },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 15 },
        ],
      },
    };

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("[createGoogleCalendarEvent] API error:", error);
      throw new Error(error.error?.message || "Failed to create calendar event");
    }

    const createdEvent = await response.json();
    console.log("[createGoogleCalendarEvent] Created event:", createdEvent.id);

    return createdEvent.id;
  } catch (error) {
    console.error("[createGoogleCalendarEvent]", error);
    throw error;
  }
}

/**
 * Update an event in Google Calendar
 */
export async function updateGoogleCalendarEvent(
  eventId: string,
  title: string,
  description: string | undefined,
  startTime: string,
  endTime: string
): Promise<void> {
  try {
    const accessToken = await getValidAccessToken();

    const event = {
      summary: title,
      description: description || `Task scheduled via DayWise`,
      start: { dateTime: startTime },
      end: { dateTime: endTime },
    };

    console.log("[updateGoogleCalendarEvent] PATCH eventId:", eventId, "body:", JSON.stringify(event));

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("[updateGoogleCalendarEvent] API error:", JSON.stringify(errorBody, null, 2));
      if (response.status === 400) {
        throw new Error("This event can't be rescheduled — you may not be the organizer, or it belongs to a shared calendar.");
      }
      throw new Error(errorBody.error?.message || "Failed to update calendar event");
    }

    console.log("[updateGoogleCalendarEvent] Updated event:", eventId);
  } catch (error) {
    console.error("[updateGoogleCalendarEvent]", error);
    throw error;
  }
}

/**
 * Delete an event from Google Calendar
 */
export async function deleteGoogleCalendarEvent(eventId: string): Promise<void> {
  try {
    const accessToken = await getValidAccessToken();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // 204 No Content is success, 404 means already deleted
    if (!response.ok && response.status !== 404) {
      const error = await response.json();
      console.error("[deleteGoogleCalendarEvent] API error:", error);
      throw new Error(error.error?.message || "Failed to delete calendar event");
    }

    console.log("[deleteGoogleCalendarEvent] Deleted event:", eventId);
  } catch (error) {
    console.error("[deleteGoogleCalendarEvent]", error);
    throw error;
  }
}

/**
 * Disconnect Google Calendar (revoke tokens and clear storage)
 * @param deleteEvents - if true, also removes synced calendar_events from DB (default true)
 */
export async function disconnectGoogleCalendar(deleteEvents = true): Promise<void> {
  try {
    const tokens = await getGoogleTokens();

    // Revoke token with Google
    if (tokens?.access_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch (revokeError) {
        console.warn("[disconnectGoogleCalendar] Revoke failed:", revokeError);
      }
    }

    // Clear stored tokens
    await SecureStore.deleteItemAsync(STORAGE_KEYS.accessToken);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.refreshToken);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.tokenExpiry);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.lastSyncTime);

    if (deleteEvents) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("calendar_events").delete().eq("user_id", user.id);
      }
    }

    console.log("[disconnectGoogleCalendar] Disconnected, deleteEvents:", deleteEvents);
  } catch (error) {
    console.error("[disconnectGoogleCalendar]", error);
    throw error;
  }
}

/**
 * Get calendar events from local database (cached)
 */
export async function getLocalCalendarEvents(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  try {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("*")
      .gte("start_time", startDate.toISOString())
      .lte("start_time", endDate.toISOString())
      .order("start_time", { ascending: true });

    if (error) {
      console.error("[getLocalCalendarEvents] Error:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("[getLocalCalendarEvents]", error);
    return [];
  }
}

/**
 * Safe wrapper for creating calendar events - doesn't throw, returns result
 * Task scheduling should continue even if calendar sync fails
 */
export async function safeCreateCalendarEvent(
  title: string,
  description: string | undefined,
  startTime: string,
  endTime: string
): Promise<CalendarOperationResult> {
  try {
    const isConnected = await isGoogleCalendarConnected();
    if (!isConnected) {
      return { success: false, error: "Google Calendar not connected" };
    }

    const eventId = await withRetry(() =>
      createGoogleCalendarEvent(title, description, startTime, endTime)
    );

    return { success: true, eventId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[safeCreateCalendarEvent] Failed:", errorMessage);

    // Save pending operation for later retry
    await savePendingCalendarOperation({
      type: "create",
      title,
      description,
      startTime,
      endTime,
      timestamp: Date.now(),
    });

    return {
      success: false,
      error: errorMessage,
      needsRetry: !errorMessage.includes("Session expired"),
    };
  }
}

/**
 * Safe wrapper for updating calendar events - doesn't throw, returns result
 */
export async function safeUpdateCalendarEvent(
  eventId: string,
  title: string,
  description: string | undefined,
  startTime: string,
  endTime: string
): Promise<CalendarOperationResult> {
  try {
    const isConnected = await isGoogleCalendarConnected();
    if (!isConnected) {
      return { success: false, error: "Google Calendar not connected" };
    }

    await withRetry(() =>
      updateGoogleCalendarEvent(eventId, title, description, startTime, endTime)
    );

    // Mirror the new times into our local Supabase cache
    await supabase
      .from("calendar_events")
      .update({ start_time: startTime, end_time: endTime, synced_at: new Date().toISOString() })
      .eq("google_event_id", eventId);

    return { success: true, eventId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[safeUpdateCalendarEvent] Failed:", errorMessage);

    const isPermanent = errorMessage.includes("organizer") || errorMessage.includes("Bad Request") || errorMessage.includes("Session expired");

    // Only queue for retry if the failure is transient (network, token expiry)
    if (!isPermanent) {
      await savePendingCalendarOperation({
        type: "update",
        eventId,
        title,
        description,
        startTime,
        endTime,
        timestamp: Date.now(),
      });
    }

    return {
      success: false,
      error: errorMessage,
      needsRetry: !isPermanent,
    };
  }
}

/**
 * Safe wrapper for deleting calendar events - doesn't throw, returns result
 */
export async function safeDeleteCalendarEvent(
  eventId: string
): Promise<CalendarOperationResult> {
  try {
    const isConnected = await isGoogleCalendarConnected();
    if (!isConnected) {
      return { success: false, error: "Google Calendar not connected" };
    }

    await withRetry(() => deleteGoogleCalendarEvent(eventId));

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[safeDeleteCalendarEvent] Failed:", errorMessage);

    // Save pending operation for later retry
    await savePendingCalendarOperation({
      type: "delete",
      eventId,
      timestamp: Date.now(),
    });

    return {
      success: false,
      error: errorMessage,
      needsRetry: !errorMessage.includes("Session expired"),
    };
  }
}

interface PendingCalendarOperation {
  type: "create" | "update" | "delete";
  eventId?: string;
  title?: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  timestamp: number;
}

/**
 * Save a pending calendar operation for later retry
 */
async function savePendingCalendarOperation(
  operation: PendingCalendarOperation
): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.pendingCalendarOps);
    const operations: PendingCalendarOperation[] = stored ? JSON.parse(stored) : [];

    operations.push(operation);

    // Keep only last 50 pending operations
    const trimmed = operations.slice(-50);

    await SecureStore.setItemAsync(
      STORAGE_KEYS.pendingCalendarOps,
      JSON.stringify(trimmed)
    );

    console.log(`[Calendar] Saved pending operation: ${operation.type}`);
  } catch (error) {
    console.error("[savePendingCalendarOperation] Error:", error);
  }
}

/**
 * Get count of pending calendar operations
 */
export async function getPendingCalendarOperationCount(): Promise<number> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.pendingCalendarOps);
    const operations: PendingCalendarOperation[] = stored ? JSON.parse(stored) : [];
    return operations.length;
  } catch (error) {
    return 0;
  }
}

/**
 * Process pending calendar operations
 */
export async function processPendingCalendarOperations(): Promise<{
  success: number;
  failed: number;
}> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.pendingCalendarOps);
    if (!stored) {
      return { success: 0, failed: 0 };
    }

    const operations: PendingCalendarOperation[] = JSON.parse(stored);
    if (operations.length === 0) {
      return { success: 0, failed: 0 };
    }

    console.log(`[Calendar] Processing ${operations.length} pending operations`);

    let success = 0;
    let failed = 0;
    const remaining: PendingCalendarOperation[] = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case "create":
            await createGoogleCalendarEvent(
              op.title!,
              op.description,
              op.startTime!,
              op.endTime!
            );
            break;
          case "update":
            await updateGoogleCalendarEvent(
              op.eventId!,
              op.title!,
              op.description,
              op.startTime!,
              op.endTime!
            );
            break;
          case "delete":
            await deleteGoogleCalendarEvent(op.eventId!);
            break;
        }
        success++;
      } catch (error) {
        console.error(`[Calendar] Failed to process ${op.type}:`, error);

        // Keep operations less than 24 hours old for retry
        const age = Date.now() - op.timestamp;
        if (age < 24 * 60 * 60 * 1000) {
          remaining.push(op);
        } else {
          failed++;
        }
      }
    }

    // Save remaining operations
    await SecureStore.setItemAsync(
      STORAGE_KEYS.pendingCalendarOps,
      JSON.stringify(remaining)
    );

    console.log(`[Calendar] Processed: ${success} success, ${failed} failed, ${remaining.length} remaining`);
    return { success, failed };
  } catch (error) {
    console.error("[processPendingCalendarOperations] Error:", error);
    return { success: 0, failed: 0 };
  }
}
