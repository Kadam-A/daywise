/**
 * Settings Screen
 *
 * User preferences and account management
 */

import { View, StyleSheet, ScrollView, Alert, Pressable } from "react-native";
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
import { router } from "expo-router";
import { useState, useEffect } from "react";
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

export default function SettingsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState(15);
  const [displayName, setDisplayName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  // Work hours state
  const [workHoursModalVisible, setWorkHoursModalVisible] = useState(false);
  const [workStartHour, setWorkStartHour] = useState(8);
  const [workEndHour, setWorkEndHour] = useState(20);
  const [savingWorkHours, setSavingWorkHours] = useState(false);

  // Reminder time modal
  const [reminderModalVisible, setReminderModalVisible] = useState(false);

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

  // Load user profile and notification settings on mount
  useEffect(() => {
    loadProfile();
    loadNotificationSettings();
  }, []);

  const loadNotificationSettings = async () => {
    try {
      const enabled = await areNotificationsEnabled();
      const minutes = await getReminderMinutes();
      setNotificationsEnabled(enabled);
      setReminderTime(minutes);
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

  const formatHourDisplay = (hour: number): string => {
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}:00 ${period}`;
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
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          Settings
        </Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <Avatar.Text size={64} label={getInitials()} style={styles.avatar} />
          <View style={styles.profileInfo}>
            <Text variant="titleLarge" style={styles.profileName}>
              {displayName || "Loading..."}
            </Text>
            <Text variant="bodyMedium" style={styles.profileEmail}>
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
            title="Personality Quiz"
            description="Retake the onboarding quiz"
            left={(props) => <List.Icon {...props} icon="head-lightbulb" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => router.push("/(auth)/onboarding")}
          />
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
            title="Default Task Duration"
            description="60 minutes"
            left={(props) => <List.Icon {...props} icon="timer" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => console.log("Default duration")}
          />
        </List.Section>

        <Divider />

        <List.Section>
          <List.Subheader>Integrations</List.Subheader>
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
                    textStyle={styles.connectedChipText}
                    style={styles.connectedChip}
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
                titleStyle={styles.disconnectText}
              />
            </>
          )}
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
            onPress={() => console.log("Privacy policy")}
          />
          <List.Item
            title="Terms of Service"
            left={(props) => <List.Icon {...props} icon="file-document" />}
            right={(props) => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => console.log("Terms")}
          />
        </List.Section>

        <View style={styles.logoutContainer}>
          <Button
            mode="outlined"
            onPress={handleLogout}
            icon="logout"
            textColor="#ef4444"
            style={styles.logoutButton}
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
          contentContainerStyle={styles.modalContainer}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>
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
          contentContainerStyle={styles.modalContainer}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>
            Set Work Hours
          </Text>
          <Text variant="bodyMedium" style={styles.workHoursHint}>
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

      {/* Reminder Time Modal */}
      <Portal>
        <Modal
          visible={reminderModalVisible}
          onDismiss={() => setReminderModalVisible(false)}
          contentContainerStyle={styles.modalContainer}
        >
          <Text variant="titleLarge" style={styles.modalTitle}>
            Reminder Time
          </Text>
          <Text variant="bodyMedium" style={styles.workHoursHint}>
            How many minutes before a task should you be reminded?
          </Text>

          <View style={styles.reminderOptions}>
            {[5, 10, 15, 30, 60].map((minutes) => (
              <Pressable
                key={minutes}
                style={[
                  styles.reminderOption,
                  reminderTime === minutes && styles.reminderOptionSelected,
                ]}
                onPress={() => setReminderTime(minutes)}
              >
                <Text
                  style={[
                    styles.reminderOptionText,
                    reminderTime === minutes && styles.reminderOptionTextSelected,
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  header: {
    padding: 24,
    paddingTop: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  title: {
    fontWeight: "bold",
  },
  content: {
    flex: 1,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#ffffff",
    marginBottom: 8,
  },
  avatar: {
    backgroundColor: "#2563eb",
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    fontWeight: "600",
  },
  profileEmail: {
    color: "#64748b",
    marginTop: 2,
  },
  logoutContainer: {
    padding: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  logoutButton: {
    borderColor: "#ef4444",
  },
  modalContainer: {
    backgroundColor: "#ffffff",
    padding: 24,
    margin: 24,
    borderRadius: 12,
  },
  modalTitle: {
    fontWeight: "600",
    marginBottom: 16,
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
    color: "#666",
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
    backgroundColor: "#dcfce7",
  },
  connectedChipText: {
    color: "#166534",
    fontSize: 12,
  },
  disconnectText: {
    color: "#ef4444",
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  reminderOptionSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  reminderOptionText: {
    color: "#64748b",
    fontSize: 14,
  },
  reminderOptionTextSelected: {
    color: "#2563eb",
    fontWeight: "600",
  },
});
