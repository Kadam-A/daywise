/**
 * TailoredTime - Notifications
 *
 * Handles push notification permissions, scheduling task reminders,
 * and managing notification preferences.
 *
 * NOTE: Push notifications don't work in Expo Go (SDK 53+).
 * Use a development build for full notification support.
 */

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Task } from "./types";

// Check if running in Expo Go (notifications limited)
const isExpoGo = Constants.appOwnership === "expo";

/**
 * Check if push notifications are available
 * Returns false in Expo Go, true in development builds
 */
export function areNotificationsAvailable(): boolean {
  return !isExpoGo;
}

// Storage keys
const STORAGE_KEYS = {
  notificationsEnabled: "notifications_enabled",
  reminderMinutes: "reminder_minutes",
};

// Default reminder time (15 minutes before)
const DEFAULT_REMINDER_MINUTES = 15;

// Configure how notifications appear when app is in foreground
// Only set up if not in Expo Go to avoid errors
if (!isExpoGo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} else {
  console.log("[Notifications] Running in Expo Go - push notifications disabled");
}

/**
 * Request notification permissions
 * Returns true if granted, false otherwise
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  // Skip in Expo Go
  if (isExpoGo) {
    console.log("[Notifications] Expo Go detected - notifications not available");
    return false;
  }

  // Check if physical device (notifications don't work in simulator)
  if (!Device.isDevice) {
    console.warn("[Notifications] Must use physical device for push notifications");
    return false;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  // Request permissions if not already granted
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[Notifications] Permission not granted");
    return false;
  }

  // Android requires a notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("task-reminders", {
      name: "Task Reminders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563eb",
      sound: "default",
    });
  }

  console.log("[Notifications] Permissions granted");
  return true;
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEYS.notificationsEnabled);
    if (enabled === null) {
      // Default to true if not set
      return true;
    }
    return enabled === "true";
  } catch (error) {
    console.error("[Notifications] Error checking enabled status:", error);
    return true;
  }
}

/**
 * Set notifications enabled/disabled
 */
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.notificationsEnabled, String(enabled));

    if (!enabled) {
      // Cancel all scheduled notifications when disabled
      await cancelAllTaskReminders();
    }

    console.log(`[Notifications] Notifications ${enabled ? "enabled" : "disabled"}`);
  } catch (error) {
    console.error("[Notifications] Error setting enabled status:", error);
    throw error;
  }
}

/**
 * Get reminder time in minutes
 */
export async function getReminderMinutes(): Promise<number> {
  try {
    const minutes = await AsyncStorage.getItem(STORAGE_KEYS.reminderMinutes);
    if (minutes === null) {
      return DEFAULT_REMINDER_MINUTES;
    }
    return parseInt(minutes, 10);
  } catch (error) {
    console.error("[Notifications] Error getting reminder minutes:", error);
    return DEFAULT_REMINDER_MINUTES;
  }
}

/**
 * Set reminder time in minutes
 */
export async function setReminderMinutes(minutes: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.reminderMinutes, String(minutes));
    console.log(`[Notifications] Reminder time set to ${minutes} minutes`);
  } catch (error) {
    console.error("[Notifications] Error setting reminder minutes:", error);
    throw error;
  }
}

/**
 * Schedule a reminder notification for a task
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  try {
    // Skip in Expo Go
    if (isExpoGo) {
      return null;
    }

    // Check if notifications are enabled
    const enabled = await areNotificationsEnabled();
    if (!enabled) {
      console.log("[Notifications] Notifications disabled, skipping reminder");
      return null;
    }

    // Check if task has a scheduled start time
    if (!task.scheduled_start) {
      console.log("[Notifications] Task has no scheduled start time");
      return null;
    }

    // Calculate reminder time
    const reminderMinutes = await getReminderMinutes();
    const taskStart = new Date(task.scheduled_start);
    const reminderTime = new Date(taskStart.getTime() - reminderMinutes * 60 * 1000);

    // Don't schedule if reminder time is in the past
    if (reminderTime <= new Date()) {
      console.log("[Notifications] Reminder time is in the past, skipping");
      return null;
    }

    // Cancel existing reminder for this task
    await cancelTaskReminder(task.id);

    // Schedule the notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "⏰ Task Starting Soon",
        body: `"${task.title}" starts in ${reminderMinutes} minutes`,
        data: { taskId: task.id },
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderTime,
      },
    });

    // Store the notification ID for later cancellation
    await storeNotificationId(task.id, notificationId);

    console.log(
      `[Notifications] Scheduled reminder for task ${task.id} at ${reminderTime.toISOString()}`
    );
    return notificationId;
  } catch (error) {
    console.error("[Notifications] Error scheduling reminder:", error);
    return null;
  }
}

/**
 * Cancel a scheduled reminder for a task
 */
export async function cancelTaskReminder(taskId: string): Promise<void> {
  try {
    // Skip in Expo Go
    if (isExpoGo) return;

    const notificationId = await getNotificationId(taskId);
    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      await removeNotificationId(taskId);
      console.log(`[Notifications] Cancelled reminder for task ${taskId}`);
    }
  } catch (error) {
    console.error("[Notifications] Error cancelling reminder:", error);
  }
}

/**
 * Cancel all scheduled task reminders
 */
export async function cancelAllTaskReminders(): Promise<void> {
  try {
    // Skip in Expo Go
    if (isExpoGo) return;

    await Notifications.cancelAllScheduledNotificationsAsync();
    await clearAllNotificationIds();
    console.log("[Notifications] Cancelled all reminders");
  } catch (error) {
    console.error("[Notifications] Error cancelling all reminders:", error);
  }
}

/**
 * Reschedule all reminders (call after changing reminder time setting)
 */
export async function rescheduleAllReminders(tasks: Task[]): Promise<void> {
  try {
    // Cancel all existing reminders
    await cancelAllTaskReminders();

    // Reschedule for all scheduled tasks
    const scheduledTasks = tasks.filter(
      (t) => t.status === "scheduled" && t.scheduled_start
    );

    for (const task of scheduledTasks) {
      await scheduleTaskReminder(task);
    }

    console.log(`[Notifications] Rescheduled reminders for ${scheduledTasks.length} tasks`);
  } catch (error) {
    console.error("[Notifications] Error rescheduling reminders:", error);
  }
}

// ============================================================
// Internal helpers for notification ID storage
// ============================================================

const NOTIFICATION_IDS_KEY = "notification_ids";

async function storeNotificationId(taskId: string, notificationId: string): Promise<void> {
  try {
    const idsJson = await AsyncStorage.getItem(NOTIFICATION_IDS_KEY);
    const ids: Record<string, string> = idsJson ? JSON.parse(idsJson) : {};
    ids[taskId] = notificationId;
    await AsyncStorage.setItem(NOTIFICATION_IDS_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error("[Notifications] Error storing notification ID:", error);
  }
}

async function getNotificationId(taskId: string): Promise<string | null> {
  try {
    const idsJson = await AsyncStorage.getItem(NOTIFICATION_IDS_KEY);
    if (!idsJson) return null;
    const ids: Record<string, string> = JSON.parse(idsJson);
    return ids[taskId] || null;
  } catch (error) {
    console.error("[Notifications] Error getting notification ID:", error);
    return null;
  }
}

async function removeNotificationId(taskId: string): Promise<void> {
  try {
    const idsJson = await AsyncStorage.getItem(NOTIFICATION_IDS_KEY);
    if (!idsJson) return;
    const ids: Record<string, string> = JSON.parse(idsJson);
    delete ids[taskId];
    await AsyncStorage.setItem(NOTIFICATION_IDS_KEY, JSON.stringify(ids));
  } catch (error) {
    console.error("[Notifications] Error removing notification ID:", error);
  }
}

async function clearAllNotificationIds(): Promise<void> {
  try {
    await AsyncStorage.removeItem(NOTIFICATION_IDS_KEY);
  } catch (error) {
    console.error("[Notifications] Error clearing notification IDs:", error);
  }
}

/**
 * Setup notification response handler (for when user taps notification)
 */
export function setupNotificationResponseHandler(
  onNotificationTap: (taskId: string) => void
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as { taskId?: string } | undefined;
      const taskId = data?.taskId;
      if (taskId) {
        onNotificationTap(taskId);
      }
    }
  );

  return () => subscription.remove();
}

/**
 * Get all scheduled notifications (for debugging)
 */
export async function getScheduledNotifications(): Promise<
  Notifications.NotificationRequest[]
> {
  return await Notifications.getAllScheduledNotificationsAsync();
}
