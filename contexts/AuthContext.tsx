/**
 * AuthContext
 *
 * Provides authentication state and user role throughout the app.
 * Wraps Supabase auth and adds role-based access control.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, signOut as supabaseSignOut } from '@/lib/supabase';
import { setSentryUser, clearSentryUser } from '@/lib/sentry';
import { identifyUser, resetUser as resetPostHogUser, capture as capturePostHog } from '@/lib/posthog';
import { trackSignedIn } from '@/lib/analytics';

export type UserRole = 'user' | 'admin' | 'super_admin';

interface AuthContextValue {
  // Auth state
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Role state
  role: UserRole;
  isAdmin: boolean;
  isSuperAdmin: boolean;

  // Actions
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  role: 'user',
  isAdmin: false,
  isSuperAdmin: false,
  signOut: async () => {},
  refreshRole: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>('user');
  const [isLoading, setIsLoading] = useState(true);

  // Fetch user role from database
  const fetchRole = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase.rpc('get_user_role', {
        check_user_id: userId,
      });

      if (error) {
        console.error('[AuthContext] Error fetching role:', error);
        setRole('user');
        return;
      }

      setRole((data as UserRole) || 'user');
      console.log('[AuthContext] User role:', data);
    } catch (err) {
      console.error('[AuthContext] Error in fetchRole:', err);
      setRole('user');
    }
  }, []);

  // Refresh role (can be called manually)
  const refreshRole = useCallback(async () => {
    if (user?.id) {
      await fetchRole(user.id);
    }
  }, [user?.id, fetchRole]);

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession?.user) {
          setSession(currentSession);
          setUser(currentSession.user);
          // fetchRole is called by the user?.id effect below — no duplicate call needed
          setSentryUser(currentSession.user.id, currentSession.user.email);
          identifyUser(currentSession.user.id, currentSession.user.email);
        }
      } catch (err) {
        console.error('[AuthContext] Init error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes.
    // IMPORTANT: Do NOT call supabase.rpc() / supabase.from() / supabase.auth.getSession()
    // inside this callback. Supabase awaits all onAuthStateChange callbacks while holding
    // the auth mutex. Any supabase.* call here will try to re-acquire that mutex → deadlock.
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        console.log('[AuthContext] Auth event:', event);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          setUser(newSession?.user ?? null);
          if (newSession?.user) {
            setSentryUser(newSession.user.id, newSession.user.email);
            identifyUser(newSession.user.id, newSession.user.email);
            if (event === 'SIGNED_IN') trackSignedIn();
          }
        } else if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setRole('user');
          clearSentryUser();
          capturePostHog('user_signed_out');
          resetPostHogUser();
        }

        setIsLoading(false);
      }
    );

    return () => {
      authSubscription.unsubscribe();
    };
  }, []);

  // Fetch role whenever the authenticated user changes.
  // This runs in a React effect — completely outside the Supabase auth mutex.
  useEffect(() => {
    if (user?.id) {
      fetchRole(user.id);
    }
  }, [user?.id, fetchRole]);

  // Sign out handler
  const handleSignOut = useCallback(async () => {
    try {
      await supabaseSignOut();
      setUser(null);
      setSession(null);
      setRole('user');
    } catch (err) {
      console.error('[AuthContext] Sign out error:', err);
      throw err;
    }
  }, []);

  // Derived values
  const isAuthenticated = !!user && !!session;
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSuperAdmin = role === 'super_admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isAuthenticated,
        role,
        isAdmin,
        isSuperAdmin,
        signOut: handleSignOut,
        refreshRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
