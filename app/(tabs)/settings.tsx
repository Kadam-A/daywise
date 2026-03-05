/**
 * Settings Screen
 *
 * User preferences and account management
 */

import { View, StyleSheet, ScrollView, Alert, Pressable, Platform, Modal as RNModal } from "react-native";
import {
  Text,
  List,
  Switch,
  Button,
  Divider,
  Portal,
  Modal,
  TextInput,
  Avatar,
  ActivityIndicator,
  Chip,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { supabase, signOut } from "@/lib/supabase";
import { useGoogleCalendarAuth } from "@/lib/google-calendar";
import {
  requestNotificationPermissions,
  areNotificationsEnabled,
  setNotificationsEnabled as setNotificationsEnabledStorage,
  getReminderMinutes,
  setReminderMinutes,
} from "@/lib/notifications";
import { format } from "date-fns";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { FeedbackCategory } from "@/lib/types";
import ComprehensiveFeedbackModal from "@/components/ComprehensiveFeedbackModal";
import HelpFAQModal from "@/components/HelpFAQModal";
import { useAuth } from "@/contexts/AuthContext";
import { useThemeMode, useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import TourTooltip from "@/components/TourTooltip";

const COLORS = {
  primary: "#4A90E2",
  secondary: "#7C6FBF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  success: "#5FBF73",
  warning: "#F5A962",
  error: "#E25555",
  border: "#E5E7EB",
};

export default function SettingsScreen() {
  const { tourStep, advanceTour, skipTour } = useGuidedTour();
  const { isPro } = useSubscription();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState(15);
  const [displayName, setDisplayName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  // Help & Feedback state
  const [helpFaqVisible, setHelpFaqVisible] = useState(false);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory | undefined>(undefined);

  // Work hours state
  const [workHoursModalVisible, setWorkHoursModalVisible] = useState(false);
  const [workStartHour, setWorkStartHour] = useState(8);
  const [workEndHour, setWorkEndHour] = useState(20);
  const [savingWorkHours, setSavingWorkHours] = useState(false);

  // Auto-reschedule state (stored as total minutes from midnight)
  const [autoRescheduleModalVisible, setAutoRescheduleModalVisible] = useState(false);
  const [autoRescheduleEnabled, setAutoRescheduleEnabled] = useState(true);
  const [autoRescheduleMorning, setAutoRescheduleMorning] = useState(540);  // 9:00am
  const [autoRescheduleEvening, setAutoRescheduleEvening] = useState(1140); // 7:00pm
  // Tracks the last successfully saved values so dismissing without saving doesn't corrupt display
  const savedAutoRescheduleRef = useRef({ enabled: true, morning: 540, evening: 1140 });
  const [savingAutoReschedule, setSavingAutoReschedule] = useState(false);
  const [showMorningPicker, setShowMorningPicker] = useState(false);
  const [showEveningPicker, setShowEveningPicker] = useState(false);
  const [morningPickerDate, setMorningPickerDate] = useState(() => { const d = new Date(); d.setHours(9, 0, 0, 0); return d; });
  const [eveningPickerDate, setEveningPickerDate] = useState(() => { const d = new Date(); d.setHours(19, 0, 0, 0); return d; });

  // Reminder time modal
  const [reminderModalVisible, setReminderModalVisible] = useState(false);

  // Default task duration
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [durationModalVisible, setDurationModalVisible] = useState(false);

  // Google Calendar state
  const {
    isConnected: isCalendarConnected,
    isLoading: isCalendarLoading,
    lastSyncTime,
    connect: connectCalendar,
    disconnect: disconnectCalendar,
    syncCalendarEvents,
    isReady: isCalendarReady,
  } = useGoogleCalendarAuth();

  // Auth context for admin check
  const { isAdmin, role } = useAuth();

  // Theme mode
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const appColors = useAppColors();

  // Load user profile and notification settings on mount
  useEffect(() => {
    loadProfile();
    loadNotificationSettings();
  }, []);

  // Auto-advance tour when settings tab gets focus
  useFocusEffect(
    useCallback(() => {
      if (tourStep === "tour_go_settings") {
        advanceTour("tour_settings_intro");
      }
    }, [tourStep])
  );

  const loadNotificationSettings = async () => {
    try {
      const enabled = await areNotificationsEnabled();
      const minutes = await getReminderMinutes();
      setNotificationsEnabled(enabled);
      setReminderTime(minutes);
      const savedDuration = await AsyncStorage.getItem("defaultTaskDuration");
      if (savedDuration) setDefaultDuration(parseInt(savedDuration));
    } catch (error) {
      console.error("[Settings] Error loading notification settings:", error);
    }
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        // Request permission first
        const granted = await requestNotificationPermissions();
        if (!granted) {
          Alert.alert(
            "Permission Required",
            "Please enable notifications in your device settings to receive task reminders."
          );
          return;
        }
      }
      await setNotificationsEnabledStorage(enabled);
      setNotificationsEnabled(enabled);
    } catch (error) {
      console.error("[Settings] Error toggling notifications:", error);
    }
  };

  const handleSaveReminderTime = async () => {
    try {
      await setReminderMinutes(reminderTime);
      setReminderModalVisible(false);
    } catch (error) {
      console.error("[Settings] Error saving reminder time:", error);
    }
  };

  const loadProfile = async () => {
    try {
      // Get auth user for email and metadata
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        setEmail(user.email);
      }

      // Get profile for display name and personality data
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, personality_data")
        .single();

      // Load work hours from personality_data
      const preferredWindows = profile?.personality_data?.preferred_windows;
      if (preferredWindows && preferredWindows.length > 0) {
        const window = preferredWindows[0];
        const [startH] = window.start.split(":").map(Number);
        const [endH] = window.end.split(":").map(Number);
        setWorkStartHour(startH);
        setWorkEndHour(endH);
      }

      // Load auto-reschedule settings (migrate old hour values → minutes)
      const pd = profile?.personality_data;
      const savedEnabled = pd?.auto_reschedule_enabled ?? true;
      const savedMorning = pd?.auto_reschedule_morning !== undefined
        ? (pd.auto_reschedule_morning < 24 ? pd.auto_reschedule_morning * 60 : pd.auto_reschedule_morning)
        : 540;
      const savedEvening = pd?.auto_reschedule_evening !== undefined
        ? (pd.auto_reschedule_evening < 24 ? pd.auto_reschedule_evening * 60 : pd.auto_reschedule_evening)
        : 1140;

      setAutoRescheduleEnabled(savedEnabled);
      setAutoRescheduleMorning(savedMorning);
      setMorningPickerDate(() => { const d = new Date(); d.setHours(Math.floor(savedMorning / 60), savedMorning % 60, 0, 0); return d; });
      setAutoRescheduleEvening(savedEvening);
      setEveningPickerDate(() => { const d = new Date(); d.setHours(Math.floor(savedEvening / 60), savedEvening % 60, 0, 0); return d; });

      // Keep ref in sync with what's on disk so dismiss-without-save can restore
      savedAutoRescheduleRef.current = { enabled: savedEnabled, morning: savedMorning, evening: savedEvening };

      if (profile?.display_name) {
        setDisplayName(profile.display_name);
      } else if (user) {
        // Display name not set - populate from Google metadata for existing users
        const googleName =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User";

        // Save to profile
        await supabase
          .from("user_profiles")
          .update({ display_name: googleName })
          .eq("id", user.id);

        setDisplayName(googleName);
      }
    } catch (error) {
      console.error("[Settings] Error loading profile:", error);
    }
  };

  const handleEditName = () => {
    setNewName(displayName);
    setEditModalVisible(true);
  };

  const handleSaveName = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("user_profiles")
        .update({ display_name: newName.trim() })
        .eq("id", user?.id);

      if (error) throw error;

      setDisplayName(newName.trim());
      setEditModalVisible(false);
    } catch (error) {
      console.error("[Settings] Error saving name:", error);
    } finally {
      setSaving(false);
    }
  };

  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      router.replace("/(auth)/login");
    } catch (error) {
      console.error("[Settings] Logout error:", error);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all your data. This action cannot be undone.\n\nAre you sure you want to continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: confirmDeleteAccount,
        },
      ]
    );
  };

  const confirmDeleteAccount = () => {
    // Double confirmation for safety
    Alert.alert(
      "Final Confirmation",
      "Type DELETE to confirm you want to permanently delete your account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "I Understand, Delete",
          style: "destructive",
          onPress: executeDeleteAccount,
        },
      ]
    );
  };

  const executeDeleteAccount = async () => {
    try {
      setDeleteAccountLoading(true);

      const { data, error } = await supabase.functions.invoke("delete-account");

      if (error) {
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || "Failed to delete account");
      }

      Alert.alert(
        "Account Deleted",
        "Your account and all data have been permanently deleted.",
        [
          {
            text: "OK",
            onPress: () => router.replace("/(auth)/login"),
          },
        ]
      );
    } catch (error) {
      console.error("[Settings] Delete account error:", error);
      Alert.alert(
        "Error",
        "Failed to delete account. Please try again or contact support."
      );
    } finally {
      setDeleteAccountLoading(false);
    }
  };

  const handleConnectCalendar = async () => {
    try {
      await connectCalendar();
    } catch (error) {
      console.error("[Settings] Calendar connect error:", error);
      Alert.alert("Connection Failed", "Unable to connect to Google Calendar. Please try again.");
    }
  };

  const handleDisconnectCalendar = () => {
    Alert.alert(
      "Disconnect Google Calendar",
      "This will remove calendar sync. Your tasks will remain, but calendar events won't be synced.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnectCalendar();
            } catch (error) {
              console.error("[Settings] Calendar disconnect error:", error);
            }
          },
        },
      ]
    );
  };

  const handleSyncCalendar = async () => {
    try {
      await syncCalendarEvents();
      Alert.alert("Sync Complete", "Calendar events have been synced.");
    } catch (error) {
      console.error("[Settings] Calendar sync error:", error);
      Alert.alert("Sync Failed", "Unable to sync calendar. Please try again.");
    }
  };

  const handleSaveWorkHours = async () => {
    try {
      setSavingWorkHours(true);
      const { data: { user } } = await supabase.auth.getUser();

      // Get current personality_data
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("personality_data")
        .eq("id", user?.id)
        .single();

      // Create preferred_windows for all days (Mon-Fri by default)
      const startStr = `${workStartHour.toString().padStart(2, "0")}:00`;
      const endStr = `${workEndHour.toString().padStart(2, "0")}:00`;

      const preferredWindows = [1, 2, 3, 4, 5].map((day) => ({
        day,
        start: startStr,
        end: endStr,
      }));

      // Update personality_data with new preferred_windows
      const updatedPersonality = {
        ...profile?.personality_data,
        preferred_windows: preferredWindows,
      };

      const { error } = await supabase
        .from("user_profiles")
        .update({ personality_data: updatedPersonality })
        .eq("id", user?.id);

      if (error) throw error;

      setWorkHoursModalVisible(false);
    } catch (error) {
      console.error("[Settings] Error saving work hours:", error);
    } finally {
      setSavingWorkHours(false);
    }
  };

  const handleSaveAutoReschedule = async () => {
    try {
      setSavingAutoReschedule(true);
      const { data: { user } } = await supabase.auth.getUser();

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("personality_data")
        .eq("id", user?.id)
        .single();

      const updatedPersonality = {
        ...profile?.personality_data,
        auto_reschedule_enabled: autoRescheduleEnabled,
        auto_reschedule_morning: autoRescheduleMorning,
        auto_reschedule_evening: autoRescheduleEvening,
        // Capture device timezone so the Edge Function can convert UTC → local hour
        auto_reschedule_tz_offset: -new Date().getTimezoneOffset() / 60,
      };

      const { error } = await supabase
        .from("user_profiles")
        .update({ personality_data: updatedPersonality })
        .eq("id", user?.id);

      if (error) throw error;
      // Mark intro as seen — user has made an explicit choice via Settings
      await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
      // Keep ref in sync so dismiss-without-save can restore correctly
      savedAutoRescheduleRef.current = { enabled: autoRescheduleEnabled, morning: autoRescheduleMorning, evening: autoRescheduleEvening };
      setAutoRescheduleModalVisible(false);
    } catch (error) {
      console.error("[Settings] Error saving auto-reschedule settings:", error);
    } finally {
      setSavingAutoReschedule(false);
    }
  };

  const formatHourDisplay = (hour: number): string => {
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:00 ${period}`;
  };

  const formatTimeFromMinutes = (totalMinutes: number): string => {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
  };


  // Get initials for avatar
  const getInitials = () => {
    if (!displayName) return "?";
    return displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Text variant="headlineMedium" style={[styles.title, { color: appColors.textPrimary }]}>
          Settings
        </Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: appColors.surface }]}>
          <Avatar.Text size={64} label={getInitials()} style={[styles.avatar, { backgroundColor: appColors.primary }]} />
          <View style={styles.profileInfo}>
            <Text variant="titleLarge" style={[styles.profileName, { color: appColors.textPrimary }]}>
              {displayName || "Loading..."}
            </Text>
            <Text variant="bodyMedium" style={[styles.profileEmail, { color: appColors.textSecondary }]}>
              {email}
            </Text>
          </View>
        </View>

        <List.Section>
          <List.Subheader>Account</List.Subheader>
          <List.Item
            title="Display Name"
            description={displayName || "Not set"}
            left={(props) => <List.Icon {...props} icon="account-edit" />}
            right={(props) => <List.Icon {...props} icon="pencil" />}
            onPress={handleEditName}
          />
          <List.Item
            title="Your Profile"
            description="View and adjust your personality settings"
            left={(props) => <List.Icon {...props} icon="head-lightbulb" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/settings/personality")}
          />
          <List.Item
            title="Your Stats"
            description="View your productivity analytics"
            left={(props) => <List.Icon {...props} icon="chart-box-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/settings/stats")}
          />
          {isAdmin && (
            <List.Item
              title="Admin Dashboard"
              description={role === "super_admin" ? "Super Admin access" : "Admin access"}
              left={(props) => <List.Icon {...props} icon="shield-crown" color={appColors.secondary} />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => router.push("/admin")}
              titleStyle={{ color: appColors.secondary }}
            />
          )}
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Preferences</List.Subheader>
          <List.Item
            title="Notifications"
            description="Push notifications for task reminders"
            left={(props) => <List.Icon {...props} icon="bell" />}
            right={() => (
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationsToggle}
              />
            )}
          />
          {notificationsEnabled && (
            <List.Item
              title="Reminder Time"
              description={`${reminderTime} minutes before task`}
              left={(props) => <List.Icon {...props} icon="alarm" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => setReminderModalVisible(true)}
            />
          )}
          <List.Item
            title="Work Hours"
            description={`${formatHourDisplay(workStartHour)} - ${formatHourDisplay(workEndHour)}`}
            left={(props) => <List.Icon {...props} icon="clock" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setWorkHoursModalVisible(true)}
          />
          <List.Item
            title="Auto-Reschedule"
            description={!isPro
              ? "1/week on free plan • Upgrade for unlimited"
              : autoRescheduleEnabled
                ? `${formatTimeFromMinutes(autoRescheduleMorning)} and ${formatTimeFromMinutes(autoRescheduleEvening)}`
                : "Disabled"}
            left={(props) => <List.Icon {...props} icon="clock-edit-outline" />}
            right={(props) => (
              <List.Icon {...props} icon={isPro ? "chevron-right" : "lock-outline"} />
            )}
            onPress={() => isPro ? setAutoRescheduleModalVisible(true) : router.push("/paywall")}
          />
          <List.Item
            title="Appearance"
            description={themeMode === 'system' ? 'System default' : themeMode === 'dark' ? 'Dark mode' : 'Light mode'}
            left={(props) => <List.Icon {...props} icon={themeMode === 'dark' ? 'weather-night' : themeMode === 'system' ? 'theme-light-dark' : 'white-balance-sunny'} />}
            right={() => (
              <View style={[styles.themeToggleRow, { backgroundColor: appColors.chipBg }]}>
                {(['light', 'system', 'dark'] as const).map((m) => (
                  <Pressable
                    key={m}
                    style={[styles.themeToggleChip, themeMode === m && [styles.themeToggleChipActive, { backgroundColor: appColors.primary }]]}
                    onPress={() => setThemeMode(m)}
                  >
                    <Text style={[styles.themeToggleText, { color: appColors.textSecondary }, themeMode === m && styles.themeToggleTextActive]}>
                      {m === 'system' ? 'Auto' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          />
          <List.Item
            title="Default Task Duration"
            description={defaultDuration < 60 ? `${defaultDuration} minutes` : defaultDuration === 60 ? "1 hour" : `${defaultDuration / 60} hours`}
            left={(props) => <List.Icon {...props} icon="timer" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setDurationModalVisible(true)}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Integrations</List.Subheader>
          {isAdmin ? (
            <>
              <List.Item
                title="Google Calendar"
                description={
                  isCalendarLoading
                    ? "Loading..."
                    : isCalendarConnected
                    ? lastSyncTime
                      ? `Last synced ${format(lastSyncTime, "MMM d 'at' h:mm a")}`
                      : "Connected"
                    : "Not connected"
                }
                left={(props) => <List.Icon {...props} icon="google" />}
                right={() => (
                  <View style={styles.calendarRight}>
                    {isCalendarLoading ? (
                      <ActivityIndicator size="small" />
                    ) : isCalendarConnected ? (
                      <Chip
                        mode="flat"
                        textStyle={[styles.connectedChipText, { color: appColors.success }]}
                        style={[styles.connectedChip, { backgroundColor: appColors.successLight }]}
                      >
                        Connected
                      </Chip>
                    ) : (
                      <Button
                        mode="contained"
                        compact
                        onPress={handleConnectCalendar}
                        disabled={!isCalendarReady}
                      >
                        Connect
                      </Button>
                    )}
                  </View>
                )}
              />
              {isCalendarConnected && (
                <>
                  <List.Item
                    title="Sync Now"
                    description="Refresh calendar events"
                    left={(props) => <List.Icon {...props} icon="sync" />}
                    right={() =>
                      isCalendarLoading ? (
                        <ActivityIndicator size="small" style={{ marginRight: 16 }} />
                      ) : null
                    }
                    onPress={handleSyncCalendar}
                    disabled={isCalendarLoading}
                  />
                  <List.Item
                    title="Disconnect"
                    description="Remove Google Calendar sync"
                    left={(props) => <List.Icon {...props} icon="link-off" />}
                    onPress={handleDisconnectCalendar}
                    titleStyle={[styles.disconnectText, { color: appColors.error }]}
                  />
                </>
              )}
            </>
          ) : (
            <List.Item
              title="Google Calendar"
              description="Sync your calendar events"
              left={(props) => <List.Icon {...props} icon="google" />}
              right={() => (
                <Chip
                  mode="flat"
                  textStyle={[styles.comingSoonChipText, { color: appColors.textTertiary }]}
                  style={[styles.comingSoonChip, { backgroundColor: `${appColors.textTertiary}15` }]}
                >
                  Coming Soon
                </Chip>
              )}
            />
          )}
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Help & Support</List.Subheader>
          <List.Item
            title="Help & FAQ"
            description="How scheduling works, task states, and more"
            left={(props) => <List.Icon {...props} icon="help-circle-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setHelpFaqVisible(true)}
          />
          <List.Item
            title="Send Feedback"
            description="Share your thoughts"
            left={(props) => <List.Icon {...props} icon="comment-text-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setFeedbackModalVisible(true)}
          />
          <List.Item
            title="Request a Feature"
            description="Tell us what's missing"
            left={(props) => <List.Icon {...props} icon="lightbulb-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => {
              setFeedbackCategory('missing_feature');
              setFeedbackModalVisible(true);
            }}
          />
          <List.Item
            title="Report a Bug"
            description="Something not working?"
            left={(props) => <List.Icon {...props} icon="bug-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => {
              setFeedbackCategory('bug');
              setFeedbackModalVisible(true);
            }}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>About</List.Subheader>
          <List.Item
            title="Version"
            description="1.0.0 (MVP)"
            left={(props) => <List.Icon {...props} icon="information" />}
          />
          <List.Item
            title="Privacy Policy"
            left={(props) => <List.Icon {...props} icon="shield-account" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => Alert.alert("Coming Soon", "Privacy Policy will be available when we launch.")}
          />
          <List.Item
            title="Terms of Service"
            left={(props) => <List.Icon {...props} icon="file-document" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => Alert.alert("Coming Soon", "Terms of Service will be available when we launch.")}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader style={[styles.dangerHeader, { color: appColors.error }]}>Danger Zone</List.Subheader>
          <List.Item
            title="Delete Account"
            description="Permanently delete your account and all data"
            left={(props) => <List.Icon {...props} icon="delete-forever" color={appColors.error} />}
            right={() =>
              deleteAccountLoading ? (
                <ActivityIndicator size="small" color={appColors.error} style={{ marginRight: 16 }} />
              ) : null
            }
            onPress={handleDeleteAccount}
            disabled={deleteAccountLoading}
            titleStyle={[styles.deleteAccountText, { color: appColors.error }]}
            descriptionStyle={[styles.deleteAccountDescription, { color: appColors.error }]}
          />
        </List.Section>

        <View style={styles.logoutContainer}>
          <Button
            mode="outlined"
            onPress={handleLogout}
            icon="logout"
            textColor={appColors.error}
            style={[styles.logoutButton, { borderColor: appColors.error }]}
          >
            Log Out
          </Button>
        </View>
      </ScrollView>

      {/* Edit Name Modal */}
      <Portal>
        <Modal
          visible={editModalVisible}
          onDismiss={() => setEditModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: appColors.surface }]}
        >
          <Text variant="titleLarge" style={[styles.modalTitle, { color: appColors.textPrimary }]}>
            Edit Display Name
          </Text>
          <TextInput
            label="Display Name"
            value={newName}
            onChangeText={setNewName}
            mode="outlined"
            style={styles.modalInput}
            autoFocus
          />
          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => setEditModalVisible(false)}
              style={styles.modalButton}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSaveName}
              loading={saving}
              disabled={!newName.trim() || saving}
              style={styles.modalButton}
            >
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Work Hours Modal */}
      <Portal>
        <Modal
          visible={workHoursModalVisible}
          onDismiss={() => setWorkHoursModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: appColors.surface }]}
        >
          <Text variant="titleLarge" style={[styles.modalTitle, { color: appColors.textPrimary }]}>
            Set Work Hours
          </Text>
          <Text variant="bodyMedium" style={[styles.workHoursHint, { color: appColors.textSecondary }]}>
            The scheduler will prefer times within these hours, but you can still manually pick any time.
          </Text>

          <View style={styles.workHoursRow}>
            <Text variant="bodyLarge">Start:</Text>
            <View style={styles.hourPicker}>
              <Button
                mode="outlined"
                compact
                onPress={() => setWorkStartHour(Math.max(0, workStartHour - 1))}
              >
                -
              </Button>
              <Text variant="titleMedium" style={styles.hourText}>
                {formatHourDisplay(workStartHour)}
              </Text>
              <Button
                mode="outlined"
                compact
                onPress={() => setWorkStartHour(Math.min(23, workStartHour + 1))}
              >
                +
              </Button>
            </View>
          </View>

          <View style={styles.workHoursRow}>
            <Text variant="bodyLarge">End:</Text>
            <View style={styles.hourPicker}>
              <Button
                mode="outlined"
                compact
                onPress={() => setWorkEndHour(Math.max(workStartHour + 1, workEndHour - 1))}
              >
                -
              </Button>
              <Text variant="titleMedium" style={styles.hourText}>
                {formatHourDisplay(workEndHour)}
              </Text>
              <Button
                mode="outlined"
                compact
                onPress={() => setWorkEndHour(Math.min(24, workEndHour + 1))}
              >
                +
              </Button>
            </View>
          </View>

          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => setWorkHoursModalVisible(false)}
              style={styles.modalButton}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSaveWorkHours}
              loading={savingWorkHours}
              disabled={savingWorkHours || workEndHour <= workStartHour}
              style={styles.modalButton}
            >
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Auto-Reschedule Modal */}
      <Portal>
        <Modal
          visible={autoRescheduleModalVisible}
          onDismiss={() => {
            // Restore to last-saved values so unsaved changes don't corrupt the display
            const s = savedAutoRescheduleRef.current;
            setAutoRescheduleEnabled(s.enabled);
            setAutoRescheduleMorning(s.morning);
            setMorningPickerDate(() => { const d = new Date(); d.setHours(Math.floor(s.morning / 60), s.morning % 60, 0, 0); return d; });
            setAutoRescheduleEvening(s.evening);
            setEveningPickerDate(() => { const d = new Date(); d.setHours(Math.floor(s.evening / 60), s.evening % 60, 0, 0); return d; });
            setShowMorningPicker(false);
            setShowEveningPicker(false);
            setAutoRescheduleModalVisible(false);
          }}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: appColors.surface }]}
        >
          <Text variant="titleLarge" style={[styles.modalTitle, { color: appColors.textPrimary }]}>
            Auto-Reschedule
          </Text>
          <Text variant="bodyMedium" style={[styles.workHoursHint, { color: appColors.textSecondary }]}>
            Missed tasks are automatically rescheduled twice a day at your chosen times.
          </Text>

          <View style={[styles.workHoursRow, { marginBottom: 20 }]}>
            <Text variant="bodyLarge" style={{ color: appColors.textPrimary }}>Enabled</Text>
            <Switch value={autoRescheduleEnabled} onValueChange={setAutoRescheduleEnabled} />
          </View>

          {autoRescheduleEnabled && (
            <>
              {/* Morning */}
              <View style={[styles.workHoursRow, { marginBottom: 4 }]}>
                <Text variant="bodyLarge" style={{ color: appColors.textPrimary }}>Morning</Text>
                <Pressable
                  onPress={() => { setShowEveningPicker(false); setShowMorningPicker(true); }}
                  style={[styles.timeDisplayButton, { backgroundColor: appColors.chipBg }]}
                >
                  <MaterialCommunityIcons name="clock-outline" size={15} color={appColors.primary} />
                  <Text style={[styles.timeDisplayText, { color: appColors.primary }]}>
                    {formatTimeFromMinutes(autoRescheduleMorning)}
                  </Text>
                </Pressable>
              </View>
              {showMorningPicker && (
                <DateTimePicker
                  mode="time"
                  value={morningPickerDate}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, date) => {
                    if (Platform.OS !== "ios") setShowMorningPicker(false);
                    if (date) {
                      setMorningPickerDate(date);
                      setAutoRescheduleMorning(date.getHours() * 60 + date.getMinutes());
                    }
                  }}
                />
              )}

              {/* Evening */}
              <View style={[styles.workHoursRow, { marginTop: 12, marginBottom: 4 }]}>
                <Text variant="bodyLarge" style={{ color: appColors.textPrimary }}>Evening</Text>
                <Pressable
                  onPress={() => { setShowMorningPicker(false); setShowEveningPicker(true); }}
                  style={[styles.timeDisplayButton, { backgroundColor: appColors.chipBg }]}
                >
                  <MaterialCommunityIcons name="clock-outline" size={15} color={appColors.primary} />
                  <Text style={[styles.timeDisplayText, { color: appColors.primary }]}>
                    {formatTimeFromMinutes(autoRescheduleEvening)}
                  </Text>
                </Pressable>
              </View>
              {showEveningPicker && (
                <DateTimePicker
                  mode="time"
                  value={eveningPickerDate}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, date) => {
                    if (Platform.OS !== "ios") setShowEveningPicker(false);
                    if (date) {
                      setEveningPickerDate(date);
                      setAutoRescheduleEvening(date.getHours() * 60 + date.getMinutes());
                    }
                  }}
                />
              )}
            </>
          )}

          <View style={styles.modalButtons}>
            <Button mode="outlined" onPress={() => setAutoRescheduleModalVisible(false)} style={styles.modalButton}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSaveAutoReschedule}
              loading={savingAutoReschedule}
              disabled={savingAutoReschedule}
              style={styles.modalButton}
            >
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Reminder Time Modal */}
      <Portal>
        <Modal
          visible={reminderModalVisible}
          onDismiss={() => setReminderModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: appColors.surface }]}
        >
          <Text variant="titleLarge" style={[styles.modalTitle, { color: appColors.textPrimary }]}>
            Reminder Time
          </Text>
          <Text variant="bodyMedium" style={[styles.workHoursHint, { color: appColors.textSecondary }]}>
            How many minutes before a task should you be reminded?
          </Text>

          <View style={styles.reminderOptions}>
            {[5, 10, 15, 30, 60].map((minutes) => (
              <Pressable
                key={minutes}
                style={[
                  styles.reminderOption,
                  { borderColor: appColors.border, backgroundColor: appColors.surface },
                  reminderTime === minutes && [styles.reminderOptionSelected, { borderColor: appColors.primary, backgroundColor: appColors.primaryLight }],
                ]}
                onPress={() => setReminderTime(minutes)}
              >
                <Text
                  style={[
                    styles.reminderOptionText,
                    { color: appColors.textSecondary },
                    reminderTime === minutes && [styles.reminderOptionTextSelected, { color: appColors.primary }],
                  ]}
                >
                  {minutes < 60 ? `${minutes} min` : "1 hour"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => setReminderModalVisible(false)}
              style={styles.modalButton}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSaveReminderTime}
              style={styles.modalButton}
            >
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Default Task Duration Modal */}
      <Portal>
        <Modal
          visible={durationModalVisible}
          onDismiss={() => setDurationModalVisible(false)}
          contentContainerStyle={[styles.modalContainer, { backgroundColor: appColors.surface }]}
        >
          <Text variant="titleLarge" style={[styles.modalTitle, { color: appColors.textPrimary }]}>
            Default Task Duration
          </Text>
          <Text variant="bodyMedium" style={[styles.workHoursHint, { color: appColors.textSecondary }]}>
            Used when creating a new task. You can always change it per task.
          </Text>
          <View style={styles.reminderOptions}>
            {[15, 30, 60, 90, 120].map((mins) => (
              <Pressable
                key={mins}
                style={[
                  styles.reminderOption,
                  { borderColor: appColors.border, backgroundColor: appColors.surface },
                  defaultDuration === mins && [styles.reminderOptionSelected, { borderColor: appColors.primary, backgroundColor: appColors.primaryLight }],
                ]}
                onPress={() => setDefaultDuration(mins)}
              >
                <Text style={[
                  styles.reminderOptionText,
                  { color: appColors.textSecondary },
                  defaultDuration === mins && [styles.reminderOptionTextSelected, { color: appColors.primary }],
                ]}>
                  {mins < 60 ? `${mins}m` : mins === 60 ? "1h" : `${mins / 60}h`}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.modalButtons}>
            <Button mode="outlined" onPress={() => setDurationModalVisible(false)} style={styles.modalButton}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={async () => {
                await AsyncStorage.setItem("defaultTaskDuration", String(defaultDuration));
                setDurationModalVisible(false);
              }}
              style={styles.modalButton}
            >
              Save
            </Button>
          </View>
        </Modal>
      </Portal>

      {/* Help & FAQ Modal */}
      <HelpFAQModal
        visible={helpFaqVisible}
        onClose={() => setHelpFaqVisible(false)}
      />

      {/* Comprehensive Feedback Modal */}
      <ComprehensiveFeedbackModal
        visible={feedbackModalVisible}
        onClose={() => {
          setFeedbackModalVisible(false);
          setFeedbackCategory(undefined);
        }}
        initialCategory={feedbackCategory}
      />

      {/* Tour Tooltip: settings intro */}
      <TourTooltip
        visible={tourStep === "tour_settings_intro"}
        icon="tune-variant"
        iconColor={appColors.primary}
        title="You're all set!"
        body="Explore your preferences here anytime. The AI will keep learning from your habits."
        ctaLabel="Finish Tour"
        onCta={() => advanceTour(null)}
        onSkip={skipTour}
        showSkip
      />

      {/* Tour completion modal */}
      <RNModal
        visible={tourStep === "tour_complete"}
        transparent
        animationType="fade"
        statusBarTranslucent
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={[{ borderRadius: 24, padding: 28, alignItems: "center", width: "100%", maxWidth: 360, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 }, { backgroundColor: appColors.surface }]}>
            <View style={[{ width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 20 }, { backgroundColor: `${appColors.success}20` }]}>
              <MaterialCommunityIcons name="check-decagram-outline" size={52} color={appColors.success} />
            </View>
            <Text style={[{ fontSize: 24, fontWeight: "800", textAlign: "center", marginBottom: 8 }, { color: appColors.textPrimary }]}>
              You're all set!
            </Text>
            <Text style={[{ fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 28 }, { color: appColors.textSecondary }]}>
              You know how to create AI tasks, handle overdue items, and read your full schedule.
            </Text>
            <Pressable
              style={[{ borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignSelf: "stretch", alignItems: "center" }, { backgroundColor: appColors.success }]}
              onPress={async () => {
                await skipTour();
                router.push("/(tabs)/home");
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 16 }}>Start using DayWise</Text>
            </Pressable>
          </View>
        </View>
      </RNModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 24,
    paddingTop: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontWeight: "bold",
    color: COLORS.textPrimary,
  },
  content: {
    flex: 1,
  },
  // Theme toggle
  themeToggleRow: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    padding: 2,
  },
  themeToggleChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  themeToggleChipActive: {
    backgroundColor: COLORS.primary,
  },
  themeToggleText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  themeToggleTextActive: {
    color: "#FFFFFF",
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 24,
    backgroundColor: COLORS.surface,
    marginBottom: 8,
  },
  avatar: {
    backgroundColor: COLORS.primary,
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  profileEmail: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  logoutContainer: {
    padding: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  logoutButton: {
    borderColor: COLORS.error,
  },
  modalContainer: {
    backgroundColor: COLORS.surface,
    padding: 24,
    margin: 24,
    borderRadius: 16,
  },
  modalTitle: {
    fontWeight: "600",
    marginBottom: 16,
    color: COLORS.textPrimary,
  },
  modalInput: {
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButton: {
    minWidth: 80,
  },
  workHoursHint: {
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  workHoursRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  hourPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hourText: {
    minWidth: 90,
    textAlign: "center",
  },
  calendarRight: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 8,
  },
  connectedChip: {
    backgroundColor: "#E8F5E9",
  },
  connectedChipText: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: "600",
  },
  comingSoonChip: {
    marginRight: 8,
  },
  comingSoonChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  disconnectText: {
    color: COLORS.error,
  },
  dangerHeader: {
    color: COLORS.error,
    fontWeight: "600",
  },
  deleteAccountText: {
    color: COLORS.error,
  },
  deleteAccountDescription: {
    color: COLORS.error,
    opacity: 0.8,
  },
  reminderOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  reminderOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  reminderOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: "#EBF4FF",
  },
  reminderOptionText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  reminderOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: "600",
  },
});
