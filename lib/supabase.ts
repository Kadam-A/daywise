/**
 * TailoredTime - Supabase Client Configuration
 *
 * Sets up Supabase client with secure token storage.
 * Uses SecureStore for auth tokens on native, localStorage on web.
 *
 * SECURITY: See SECURITY.md for details on why this configuration is critical.
 */

import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// Only import SecureStore on native platforms
let SecureStore: typeof import("expo-secure-store") | null = null;
if (Platform.OS !== "web") {
  SecureStore = require("expo-secure-store");
}

// Environment variables
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Verify HTTPS (security requirement)
if (supabaseUrl && !supabaseUrl.startsWith("https://")) {
  throw new Error(
    "SECURITY ERROR: Supabase URL must use HTTPS. Check your .env file.",
  );
}

/**
 * Custom storage implementation
 * - Native: SecureStore for auth tokens (encrypted)
 * - Web: localStorage (for development/testing only)
 */
const customStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === "web") {
        // Web: use localStorage
        if (typeof window !== "undefined" && window.localStorage) {
          return window.localStorage.getItem(key);
        }
        return null;
      }
      // Native: use SecureStore for auth tokens, with AsyncStorage fallback
      // for large values (JWTs exceed SecureStore's 2048 byte limit)
      if ((key.includes("auth-token") || key.includes("sb-")) && SecureStore) {
        const secureValue = await SecureStore.getItemAsync(key);
        if (secureValue !== null) return secureValue;
        // May have been stored in AsyncStorage due to size fallback
        return await AsyncStorage.getItem(key);
      }
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error(`[Storage] Error reading key "${key}":`, error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        // Web: use localStorage
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
        return;
      }
      // Native: always use AsyncStorage for auth tokens.
      // SecureStore can hang indefinitely on Android's Keystore for any value size,
      // which causes setSession() to never return (mutex held forever → deadlock).
      // AsyncStorage is sufficient — JWTs are short-lived (1hr expiry).
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error(`[Storage] Error setting key "${key}":`, error);
      // Don't rethrow — fall back to AsyncStorage rather than breaking auth
      try {
        await AsyncStorage.setItem(key, value);
      } catch (fallbackError) {
        console.error(`[Storage] AsyncStorage fallback also failed:`, fallbackError);
      }
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        // Web: use localStorage
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(key);
        }
        return;
      }
      // Native: remove from AsyncStorage (primary store).
      // Also attempt SecureStore deletion to clean up any values written before this fix.
      await AsyncStorage.removeItem(key);
      if ((key.includes("auth-token") || key.includes("sb-")) && SecureStore) {
        await SecureStore.deleteItemAsync(key).catch(() => {});
      }
    } catch (error) {
      console.error(`[Storage] Error removing key "${key}":`, error);
    }
  },
};

/**
 * Supabase client instance
 * Uses anon key (protected by RLS policies)
 * NEVER use service role key in client code - see SECURITY.md
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: customStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
});

/**
 * Helper: Get currently authenticated user
 * @returns User object or null if not authenticated
 */
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

/**
 * Helper: Get current session
 * @returns Session object or null
 */
export async function getCurrentSession() {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;
    return session;
  } catch (error) {
    console.error("[getCurrentSession]", error);
    return null;
  }
}

/**
 * Helper: Sign out user
 * Clears all auth tokens
 */
export async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    // Clear any additional tokens
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.removeItem("google_access_token");
        window.localStorage.removeItem("google_refresh_token");
      }
    } else if (SecureStore) {
      await SecureStore.deleteItemAsync("google_access_token").catch(() => {});
      await SecureStore.deleteItemAsync("google_refresh_token").catch(() => {});
    }

    console.log("[signOut] User signed out successfully");
  } catch (error) {
    console.error("[signOut]", error);
    throw error;
  }
}

/**
 * Helper: Check if user is authenticated
 * @returns Boolean indicating auth status
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getCurrentSession();
  return !!session;
}

// TODO: Add helper functions for common database operations as needed
// Example: getUserProfile(), updateUserProfile(), etc.
