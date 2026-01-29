/**
 * TailoredTime - Google Calendar Integration
 *
 * Handles OAuth 2.0 authentication and calendar sync with Google Calendar API.
 * Uses PKCE for secure mobile OAuth flow.
 *
 * SECURITY: See SECURITY.md "CRITICAL #3: OAuth Security (PKCE Required)"
 */

import { useState, useEffect, useCallback } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { GoogleCalendarTokens, GoogleCalendarEvent, CalendarEvent } from "./types";
import { supabase } from "./supabase";

// Check if running in Expo Go
const isExpoGo = Constants.appOwnership === "expo";

// Complete the auth session when returning to the app
WebBrowser.maybeCompleteAuthSession();

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

// Get the appropriate client ID for the current platform
function getClientId(): string {
  if (Platform.OS === "android") {
    return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID || "";
  } else if (Platform.OS === "ios") {
    return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS || "";
  }
  // Web/Expo Go
  return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || "";
}

// Get client secret (only needed for web)
function getClientSecret(): string | undefined {
  if (Platform.OS === "web") {
    return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET_WEB;
  }
  return undefined;
}

// Storage keys
const STORAGE_KEYS = {
  accessToken: "google_access_token",
  refreshToken: "google_refresh_token",
  tokenExpiry: "google_token_expiry",
  lastSyncTime: "google_last_sync",
};

/**
 * Hook for Google Calendar OAuth authentication
 * Uses PKCE (Proof Key for Code Exchange) for security
 */
export function useGoogleCalendarAuth() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const clientId = getClientId();

  // In Expo Go, use the auth proxy (no scheme). In dev builds, use custom scheme.
  const redirectUri = isExpoGo
    ? AuthSession.makeRedirectUri({ path: "oauth" })
    : AuthSession.makeRedirectUri({ scheme: "tailoredtime", path: "oauth" });

  // Debug: Log the redirect URI being used
  console.log("[GoogleCalendar] Running in Expo Go:", isExpoGo);
  console.log("[GoogleCalendar] Client ID:", clientId ? "SET" : "MISSING!");
  console.log("[GoogleCalendar] Redirect URI:", redirectUri);

  // Create the auth request with PKCE
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      scopes: SCOPES,
      redirectUri,
      usePKCE: true,
      extraParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
    discovery
  );

  // Check connection status on mount
  useEffect(() => {
    checkConnectionStatus();
  }, []);

  // Handle OAuth response
  useEffect(() => {
    if (response?.type === "success" && response.params.code) {
      exchangeCodeForTokens(response.params.code);
    }
  }, [response]);

  const checkConnectionStatus = async () => {
    try {
      setIsLoading(true);
      const tokens = await getGoogleTokens();
      setIsConnected(!!tokens);

      const lastSync = await SecureStore.getItemAsync(STORAGE_KEYS.lastSyncTime);
      if (lastSync) {
        setLastSyncTime(new Date(parseInt(lastSync)));
      }
    } catch (error) {
      console.error("[useGoogleCalendarAuth] Error checking status:", error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const exchangeCodeForTokens = async (code: string) => {
    try {
      setIsLoading(true);

      if (!request?.codeVerifier) {
        throw new Error("No code verifier available");
      }

      const clientSecret = getClientSecret();

      const tokenResponse = await AuthSession.exchangeCodeAsync(
        {
          clientId,
          clientSecret, // Required for web, undefined for mobile (PKCE)
          code,
          redirectUri,
          extraParams: {
            code_verifier: request.codeVerifier,
          },
        },
        discovery
      );

      const tokens: GoogleCalendarTokens = {
        access_token: tokenResponse.accessToken,
        refresh_token: tokenResponse.refreshToken || "",
        expiry_date: tokenResponse.expiresIn
          ? Date.now() + tokenResponse.expiresIn * 1000
          : Date.now() + 3600 * 1000,
        token_type: tokenResponse.tokenType || "Bearer",
        scope: SCOPES.join(" "),
      };

      await saveGoogleTokens(tokens);
      setIsConnected(true);

      // Sync calendar events after connecting
      await syncCalendarEvents();

      console.log("[useGoogleCalendarAuth] Successfully connected to Google Calendar");
    } catch (error) {
      console.error("[useGoogleCalendarAuth] Token exchange error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const connect = useCallback(async () => {
    if (!request) {
      console.warn("[useGoogleCalendarAuth] Auth request not ready");
      return;
    }
    await promptAsync();
  }, [request, promptAsync]);

  const disconnect = useCallback(async () => {
    try {
      setIsLoading(true);
      await disconnectGoogleCalendar();
      setIsConnected(false);
      setLastSyncTime(null);
    } catch (error) {
      console.error("[useGoogleCalendarAuth] Disconnect error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const syncCalendarEvents = useCallback(async () => {
    try {
      setIsLoading(true);
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 14); // Sync next 14 days

      await fetchGoogleCalendarEvents(startDate, endDate);

      const now = Date.now();
      await SecureStore.setItemAsync(STORAGE_KEYS.lastSyncTime, now.toString());
      setLastSyncTime(new Date(now));

      console.log("[useGoogleCalendarAuth] Calendar sync complete");
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
    isReady: !!request,
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

    // Upsert events to Supabase (insert or update based on google_event_id)
    for (const event of calendarEvents) {
      const { error } = await supabase
        .from("calendar_events")
        .upsert(
          {
            ...event,
            user_id: user.id,
          },
          {
            onConflict: "user_id,google_event_id",
          }
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
    return dbEvents || [];
  } catch (error) {
    console.error("[fetchGoogleCalendarEvents]", error);
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
      description: description || `Task scheduled via TailoredTime`,
      start: {
        dateTime: startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
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
      description: description || `Task scheduled via TailoredTime`,
      start: {
        dateTime: startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: endTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

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
      const error = await response.json();
      console.error("[updateGoogleCalendarEvent] API error:", error);
      throw new Error(error.error?.message || "Failed to update calendar event");
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
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  try {
    const tokens = await getGoogleTokens();

    // Revoke token with Google
    if (tokens?.access_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        });
      } catch (revokeError) {
        console.warn("[disconnectGoogleCalendar] Revoke failed:", revokeError);
        // Continue with cleanup even if revoke fails
      }
    }

    // Clear stored tokens
    await SecureStore.deleteItemAsync(STORAGE_KEYS.accessToken);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.refreshToken);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.tokenExpiry);
    await SecureStore.deleteItemAsync(STORAGE_KEYS.lastSyncTime);

    // Clear calendar events from database
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("calendar_events").delete().eq("user_id", user.id);
    }

    console.log("[disconnectGoogleCalendar] Disconnected and cleared data");
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
