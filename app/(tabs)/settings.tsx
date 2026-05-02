/**
 * Settings Screen
 *
 * User preferences and account management
 */

import { View, StyleSheet, ScrollView, Alert, Pressable, Platform, Modal as RNModal, Animated, Linking } from "react-native";
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
  TouchableRipple,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import { supabase, signOut } from "@/lib/supabase";
import { getIANATimezone, getUTCOffsetHours } from "@/lib/timezone";
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
import * as StoreReview from "expo-store-review";
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

const CONFETTI_COLORS = ['#4A90E2', '#7C6FBF', '#5FBF73', '#F5A962', '#E25555', '#F472B6'];

function SettingsItem({ onPress, style, ...props }: React.ComponentProps<typeof List.Item>) {
  const [pressed, setPressed] = useState(false);
  if (!onPress) {
    return <List.Item {...props} style={[{ backgroundColor: 'transparent' }, style]} />;
  }
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{ backgroundColor: pressed ? `${COLORS.primary}18` : 'transparent' }}
    >
      <List.Item {...props} style={[{ backgroundColor: 'transparent' }, style]} />
    </Pressable>
  );
}

function TourCompleteConfetti() {
  const particles = useMemo(() =>
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      x: Math.random() * 380,
      size: 6 + Math.random() * 8,
      delay: i * 60,
      duration: 1400 + Math.random() * 800,
      translateY: new Animated.Value(-20),
      opacity: new Animated.Value(0),
    })), []);

  useEffect(() => {
    Animated.stagger(0, particles.map((p) =>
      Animated.sequence([
        Animated.delay(p.delay),
        Animated.parallel([
          Animated.timing(p.translateY, { toValue: 700, duration: p.duration, useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(p.opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
            Animated.delay(p.duration - 400),
            Animated.timing(p.opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]),
        ]),
      ])
    )).start();
  }, []);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
      {particles.map((p) => (
        <Animated.View key={p.id} style={{
          position: 'absolute', left: p.x, top: 0,
          width: p.size, height: p.size, borderRadius: p.size / 4,
          backgroundColor: p.color,
          transform: [{ translateY: p.translateY }],
          opacity: p.opacity,
        }} />
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const { tourStep, advanceTour, skipTour: _skipTour } = useGuidedTour();
  const skipTour = useCallback(() => _skipTour(tourStep), [_skipTour, tourStep]);
  const { isPro, isTrialing, trialDaysRemaining } = useSubscription();
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

  // Reload profile every time the tab comes into focus (not just on mount)
  useFocusEffect(
    useCallback(() => {
      loadProfile();
      loadNotificationSettings();
    }, [])
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

      // Get profile — select dedicated columns alongside personality_data
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, personality_data, auto_reschedule_enabled, auto_reschedule_morning, auto_reschedule_evening")
        .single();

      // Load work hours from personality_data (still stored there)
      const preferredWindows = profile?.personality_data?.preferred_windows;
      if (preferredWindows && preferredWindows.length > 0) {
        const window = preferredWindows[0];
        const [startH] = window.start.split(":").map(Number);
        const [endH] = window.end.split(":").map(Number);
        setWorkStartHour(startH);
        setWorkEndHour(endH);
      }

      // Load auto-reschedule from dedicated columns
      const savedEnabled = profile?.auto_reschedule_enabled ?? true;
      const savedMorning = profile?.auto_reschedule_morning ?? 540;
      const savedEvening = profile?.auto_reschedule_evening ?? 1140;

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


  const handleLogout = async () => {
    try {
      await signOut();
      router.replace("/(auth)/login");
    } catch (error) {
      console.error("[Settings] Logout error:", error);
    }
  };

  const handleDeleteAccount = () => {
    router.push("/settings/account");
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
      "What would you like to do with your synced Google Calendar events in DayWise?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep Events",
          onPress: async () => {
            try {
              await disconnectCalendar(false);
            } catch (error) {
              console.error("[Settings] Calendar disconnect error:", error);
            }
          },
        },
        {
          text: "Remove Events",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnectCalendar(true);
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
      Alert.alert("Save Failed", "Couldn't save work hours. Please try again.");
    } finally {
      setSavingWorkHours(false);
    }
  };

  const handleSaveAutoReschedule = async () => {
    try {
      setSavingAutoReschedule(true);
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("user_profiles")
        .update({
          auto_reschedule_enabled: autoRescheduleEnabled,
          auto_reschedule_morning: autoRescheduleMorning,
          auto_reschedule_evening: autoRescheduleEvening,
          auto_reschedule_tz_name: getIANATimezone(),
          auto_reschedule_tz_offset: getUTCOffsetHours(),
        })
        .eq("id", user?.id);

      if (error) throw error;
      // Mark intro as seen — user has made an explicit choice via Settings
      await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
      // Keep ref in sync so dismiss-without-save can restore correctly
      savedAutoRescheduleRef.current = { enabled: autoRescheduleEnabled, morning: autoRescheduleMorning, evening: autoRescheduleEvening };
      setAutoRescheduleModalVisible(false);
    } catch (error) {
      console.error("[Settings] Error saving auto-reschedule settings:", error);
      Alert.alert("Save Failed", "Couldn't save auto-reschedule settings. Please try again.");
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
          <SettingsItem
            title="Account & Subscription"
            description={isTrialing ? `Pro Trial · ${trialDaysRemaining}d left` : isPro ? "Pro" : "Free plan"}
            left={(props) => <List.Icon {...props} icon="account-circle-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/settings/account")}
          />
          <SettingsItem
            title="Display Name"
            description={displayName || "Not set"}
            left={(props) => <List.Icon {...props} icon="account-edit" />}
            right={(props) => <List.Icon {...props} icon="pencil" />}
            onPress={handleEditName}
          />
          <SettingsItem
            title="Your Profile"
            description="View and adjust your personality settings"
            left={(props) => <List.Icon {...props} icon="head-lightbulb" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/settings/personality")}
          />
          <SettingsItem
            title="Your Stats"
            description="View your productivity analytics"
            left={(props) => <List.Icon {...props} icon="chart-box-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/settings/stats")}
          />
          {isAdmin && (
            <SettingsItem
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
          <SettingsItem
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
            <SettingsItem
              title="Reminder Time"
              description={`${reminderTime} minutes before task`}
              left={(props) => <List.Icon {...props} icon="alarm" />}
              right={(props) => <List.Icon {...props} icon="chevron-right" />}
              onPress={() => setReminderModalVisible(true)}
            />
          )}
          <SettingsItem
            title="Work Hours"
            description={`${formatHourDisplay(workStartHour)} - ${formatHourDisplay(workEndHour)}`}
            left={(props) => <List.Icon {...props} icon="clock" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setWorkHoursModalVisible(true)}
          />
          <SettingsItem
            title="Auto-Reschedule"
            description={!isPro
              ? "Pro feature • Upgrade to unlock"
              : autoRescheduleEnabled
                ? `${formatTimeFromMinutes(autoRescheduleMorning)} and ${formatTimeFromMinutes(autoRescheduleEvening)}`
                : "Disabled"}
            left={(props) => <List.Icon {...props} icon="clock-edit-outline" />}
            right={(props) => (
              <List.Icon {...props} icon={isPro ? "chevron-right" : "lock-outline"} />
            )}
            onPress={() => isPro ? setAutoRescheduleModalVisible(true) : router.push({ pathname: "/paywall", params: { source: "auto_reschedule" } })}
          />
          <SettingsItem
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
          <SettingsItem
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
              <SettingsItem
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
                  <SettingsItem
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
                  <SettingsItem
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
            <SettingsItem
              title="Google Calendar"
              description="Sync your calendar events"
              left={(props) => <List.Icon {...props} icon="google" />}
              right={() => (
                <View style={{ alignSelf: 'center', marginRight: 8 }}>
                  <Chip
                    mode="flat"
                    textStyle={[styles.comingSoonChipText, { color: appColors.textTertiary }]}
                    style={[styles.comingSoonChip, { backgroundColor: `${appColors.textTertiary}15` }]}
                  >
                    Coming Soon
                  </Chip>
                </View>
              )}
            />
          )}
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Help & Support</List.Subheader>
          <SettingsItem
            title="Help & FAQ"
            description="How scheduling works, task states, and more"
            left={(props) => <List.Icon {...props} icon="help-circle-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setHelpFaqVisible(true)}
          />
          <SettingsItem
            title="Send Feedback"
            description="Share your thoughts"
            left={(props) => <List.Icon {...props} icon="comment-text-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => setFeedbackModalVisible(true)}
          />
          <SettingsItem
            title="Request a Feature"
            description="Tell us what's missing"
            left={(props) => <List.Icon {...props} icon="lightbulb-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => {
              setFeedbackCategory('missing_feature');
              setFeedbackModalVisible(true);
            }}
          />
          <SettingsItem
            title="Report a Bug"
            description="Something not working?"
            left={(props) => <List.Icon {...props} icon="bug-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => {
              setFeedbackCategory('bug');
              setFeedbackModalVisible(true);
            }}
          />
          <SettingsItem
            title="Rate DayWise ⭐"
            description="Enjoying the app? Leave us a review"
            left={(props) => <List.Icon {...props} icon="star-outline" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={async () => {
              try {
                const available = await StoreReview.isAvailableAsync();
                if (available) {
                  const start = Date.now();
                  await StoreReview.requestReview();
                  // If it resolved in under 500ms Google silently skipped the dialog
                  if (Date.now() - start > 500) return;
                }
                // Fallback: open Play Store directly
                const marketUrl = "market://details?id=com.adam.daywise";
                const canOpen = await Linking.canOpenURL(marketUrl);
                await Linking.openURL(
                  canOpen
                    ? marketUrl
                    : "https://play.google.com/store/apps/details?id=com.adam.daywise"
                );
              } catch (e) {
                Alert.alert("Couldn't open Play Store", "Search for DayWise on the Play Store to leave a review.");
              }
            }}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>About</List.Subheader>
          <SettingsItem
            title="Version"
            description="1.0.0 (MVP)"
            left={(props) => <List.Icon {...props} icon="information" />}
          />
          <SettingsItem
            title="Privacy Policy"
            left={(props) => <List.Icon {...props} icon="shield-account" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => Linking.openURL("https://daywiseapp.com/privacy")}
          />
          <SettingsItem
            title="Terms of Service"
            left={(props) => <List.Icon {...props} icon="file-document" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => Linking.openURL("https://daywiseapp.com/terms")}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader style={[styles.dangerHeader, { color: appColors.error }]}>Danger Zone</List.Subheader>
          <SettingsItem
            title="Delete Account"
            description="Permanently delete your account and all data"
            left={(props) => <List.Icon {...props} icon="delete-forever" color={appColors.error} />}
            right={(props) => <List.Icon {...props} icon="chevron-right" color={appColors.error} />}
            onPress={handleDeleteAccount}
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
        title="Last stop — Settings"
        body="Set your work hours, notification times, and personality here. The AI keeps learning from your habits as you go."
        ctaLabel="Finish Tour"
        onCta={() => advanceTour("tour_complete")}
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
        <View style={tourCompleteStyles.overlay}>
          <TourCompleteConfetti />
          <View style={[tourCompleteStyles.card, { backgroundColor: appColors.surface }]}>

            {/* Top accent bar */}
            <View style={[tourCompleteStyles.accentBar, { backgroundColor: appColors.primary }]} />

            <View style={tourCompleteStyles.body}>
              {/* Emoji in a tinted circle */}
              <View style={[tourCompleteStyles.emojiCircle, { backgroundColor: `${appColors.primary}15` }]}>
                <Text style={tourCompleteStyles.emoji}>🎉</Text>
              </View>

              <Text style={[tourCompleteStyles.headline, { color: appColors.textPrimary }]}>
                You're all set!
              </Text>
              <Text style={[tourCompleteStyles.sub, { color: appColors.textSecondary }]}>
                You've seen everything DayWise can do. Now it's your turn.
              </Text>

              {/* Tips */}
              <View style={[tourCompleteStyles.tipsCard, { backgroundColor: appColors.background, borderColor: appColors.border }]}>
                {[
                  { icon: "calendar-refresh", text: "Overdue? Tap Reschedule All to sort them fast." },
                  { icon: "clock-alert-outline", text: "Missed a slot? Auto-reschedule handles it." },
                  { icon: "gesture-tap-hold", text: "Long press tasks to bulk complete or delete." },
                  { icon: "plus-circle-outline", text: "The + button is your quick-add shortcut." },
                ].map((tip, i) => (
                  <View key={i} style={tourCompleteStyles.tipRow}>
                    <MaterialCommunityIcons name={tip.icon as any} size={16} color={appColors.primary} />
                    <Text style={[tourCompleteStyles.tipText, { color: appColors.textSecondary }]}>{tip.text}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                style={[tourCompleteStyles.ctaButton, { backgroundColor: appColors.primary }]}
                onPress={async () => {
                  await advanceTour(null);
                  router.push("/(tabs)/home");
                }}
              >
                <Text style={tourCompleteStyles.ctaLabel}>Let's go!</Text>
                <MaterialCommunityIcons name="rocket-launch-outline" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
              </Pressable>
            </View>
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
    alignSelf: "center",
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

const tourCompleteStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  card: {
    borderRadius: 24,
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  accentBar: {
    height: 4,
    alignSelf: 'stretch',
  },
  body: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
  },
  emojiCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emoji: {
    fontSize: 36,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
  },
  tipsCard: {
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    marginBottom: 24,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 14,
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
