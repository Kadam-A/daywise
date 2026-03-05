/**
 * TailoredTime - Admin Service
 *
 * Functions for admin-only operations like viewing all feedback,
 * managing user roles, and accessing admin statistics.
 */

import { supabase } from './supabase';
import { UserRole } from '@/contexts/AuthContext';

// Types
export interface AdminStats {
  total_users: number;
  users_today: number;
  users_this_week: number;
  total_feedback: number;
  pending_feedback: number;
  total_tasks: number;
  completed_tasks: number;
  pro_users: number;
  trial_users: number;
}

export interface UserSummary {
  id: string;
  email: string | null;
  created_at: string;
  role: UserRole;
  subscription_status: string | null;
  tasks_count: number;
}

export interface RevenueStats {
  mrr_cents: number;
  active_subscribers: number;
  monthly_subscribers: number;
  yearly_subscribers: number;
  total_users: number;
  paid_users: number;
  active_trials: number;
  expired_trials: number;
  churned_users: number;
  avg_ltv_cents: number;
  revenue_this_month_cents: number;
}

export interface FeedbackItem {
  id: string;
  user_id: string;
  category: string;
  subcategory: string | null;
  trigger_point: string;
  text_feedback: string | null;
  user_email: string | null;
  status: string;
  priority: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackFilters {
  category?: string;
  status?: string;
  trigger_point?: string;
  limit?: number;
  offset?: number;
}

/**
 * Check if current user is admin
 */
export async function checkIsAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase.rpc('is_admin', {
      check_user_id: user.id,
    });

    if (error) {
      console.error('[Admin] Error checking admin status:', error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('[Admin] Error:', err);
    return false;
  }
}

/**
 * Get current user's role
 */
export async function getUserRole(): Promise<UserRole> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'user';

    const { data, error } = await supabase.rpc('get_user_role', {
      check_user_id: user.id,
    });

    if (error) {
      console.error('[Admin] Error getting role:', error);
      return 'user';
    }

    return (data as UserRole) || 'user';
  } catch (err) {
    console.error('[Admin] Error:', err);
    return 'user';
  }
}

/**
 * Get admin dashboard statistics
 * Requires admin role
 */
export async function getAdminStats(): Promise<AdminStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_admin_stats');

    if (error) {
      console.error('[Admin] Error getting stats:', error);
      return null;
    }

    return data as AdminStats;
  } catch (err) {
    console.error('[Admin] Error:', err);
    return null;
  }
}

/**
 * Get revenue statistics (super_admin only)
 */
export async function getRevenueStats(): Promise<RevenueStats | null> {
  try {
    const { data, error } = await supabase.rpc('get_revenue_stats');

    if (error) {
      console.error('[Admin] Error getting revenue stats:', error);
      return null;
    }

    return data as RevenueStats;
  } catch (err) {
    console.error('[Admin] Error:', err);
    return null;
  }
}

/**
 * Get all feedback (admin only)
 */
export async function getAllFeedback(
  filters?: FeedbackFilters
): Promise<FeedbackItem[]> {
  try {
    let query = supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false });

    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.trigger_point) {
      query = query.eq('trigger_point', filters.trigger_point);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Admin] Error fetching feedback:', error);
      return [];
    }

    return data as FeedbackItem[];
  } catch (err) {
    console.error('[Admin] Error:', err);
    return [];
  }
}

/**
 * Update feedback status (admin only)
 */
export async function updateFeedbackStatus(
  feedbackId: string,
  status: 'new' | 'reviewed' | 'resolved' | 'archived',
  priority?: 'low' | 'medium' | 'high' | 'critical',
  internalNotes?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = { status };
    if (priority !== undefined) updateData.priority = priority;
    if (internalNotes !== undefined) updateData.internal_notes = internalNotes;

    const { error } = await supabase
      .from('feedback')
      .update(updateData)
      .eq('id', feedbackId);

    if (error) {
      console.error('[Admin] Error updating feedback:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('[Admin] Error:', err);
    return { success: false, error: 'Failed to update feedback' };
  }
}

/**
 * Get all users with summary info (admin only)
 */
export async function getAllUsers(
  page: number = 0,
  limit: number = 50
): Promise<{ users: UserSummary[]; total: number }> {
  try {
    // Get total count
    const { count } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });

    // Get paginated users
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);

    if (error) {
      console.error('[Admin] Error fetching users:', error);
      return { users: [], total: 0 };
    }

    // Get additional data for each user
    const users: UserSummary[] = await Promise.all(
      (profiles || []).map(async (profile) => {
        // Get role
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', profile.id)
          .single();

        // Get subscription
        const { data: subData } = await supabase
          .from('user_subscriptions')
          .select('status')
          .eq('user_id', profile.id)
          .single();

        // Get task count
        const { count: taskCount } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', profile.id);

        return {
          id: profile.id,
          email: null, // Can't access auth.users from client
          created_at: profile.created_at,
          role: (roleData?.role as UserRole) || 'user',
          subscription_status: subData?.status || null,
          tasks_count: taskCount || 0,
        };
      })
    );

    return { users, total: count || 0 };
  } catch (err) {
    console.error('[Admin] Error:', err);
    return { users: [], total: 0 };
  }
}

/**
 * Grant admin role to a user (super_admin only)
 */
export async function grantAdminRole(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if current user is super_admin
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', {
      check_user_id: user.id,
    });

    if (!isSuperAdmin) {
      return { success: false, error: 'Only super admins can grant admin roles' };
    }

    const { error } = await supabase
      .from('user_roles')
      .upsert({
        user_id: userId,
        role: 'admin',
        granted_by: user.id,
        granted_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('[Admin] Error granting role:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('[Admin] Error:', err);
    return { success: false, error: 'Failed to grant admin role' };
  }
}

/**
 * Revoke admin role from a user (super_admin only)
 */
export async function revokeAdminRole(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Check if current user is super_admin
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', {
      check_user_id: user.id,
    });

    if (!isSuperAdmin) {
      return { success: false, error: 'Only super admins can revoke admin roles' };
    }

    // Prevent revoking own role
    if (userId === user.id) {
      return { success: false, error: 'Cannot revoke your own admin role' };
    }

    const { error } = await supabase
      .from('user_roles')
      .update({
        role: 'user',
        granted_by: user.id,
        granted_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[Admin] Error revoking role:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('[Admin] Error:', err);
    return { success: false, error: 'Failed to revoke admin role' };
  }
}
