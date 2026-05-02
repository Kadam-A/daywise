import React, { useRef, useEffect, useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { format, parseISO, differenceInMinutes, addMinutes } from "date-fns";
import { CalendarEvent } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import { safeUpdateCalendarEvent } from "@/lib/google-calendar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GOOGLE_BLUE = "#4285F4";
const SHEET_HEIGHT = 380;

interface GoogleEventSheetProps {
  event: CalendarEvent | null;
  onDismiss: () => void;
  onUpdated?: () => void;
}

export default function GoogleEventSheet({ event, onDismiss, onUpdated }: GoogleEventSheetProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();

  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const [modalVisible, setModalVisible] = useState(false);

  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  // iOS only — Android uses imperative DateTimePickerAndroid.open()
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync local state when event changes
  useEffect(() => {
    if (event) {
      setStartDate(parseISO(event.start_time));
      setEndDate(parseISO(event.end_time));
      setEditing(false);
      setShowStartPicker(false);
      setShowEndPicker(false);
    }
  }, [event?.id]);

  // Animate in when event is set
  useEffect(() => {
    if (event) {
      sheetTranslateY.setValue(SHEET_HEIGHT);
      overlayOpacity.setValue(0);
      setModalVisible(true);
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          damping: 28,
          stiffness: 300,
          mass: 0.8,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [event?.id]);

  const animateDismiss = useCallback((callback?: () => void) => {
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: SHEET_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      if (callback) callback();
      else onDismiss();
    });
  }, [onDismiss, overlayOpacity, sheetTranslateY]);

  const handleSave = async () => {
    if (!event || saving) return;
    if (endDate <= startDate) {
      Alert.alert("Invalid time", "End time must be after start time.");
      return;
    }
    setSaving(true);
    const result = await safeUpdateCalendarEvent(
      event.google_event_id,
      event.title,
      undefined,
      startDate.toISOString(),
      endDate.toISOString()
    );
    setSaving(false);
    if (result.success) {
      onUpdated?.(); // reload data immediately — runs while dismiss animation plays
      animateDismiss(() => {
        onDismiss();
      });
    } else {
      const isPermissionError = result.error?.includes("organizer") || result.error?.includes("shared calendar");
      if (isPermissionError) {
        Alert.alert(
          "Can't reschedule this event",
          "This event was created by someone else. You can only reschedule events you own — open Google Calendar to request a time change from the organizer.",
          [{ text: "Got it" }]
        );
      } else {
        Alert.alert("Couldn't save", "Something went wrong. Check your connection and try again.");
      }
    }
  };

  if (!event) return null;

  const durationMins = differenceInMinutes(parseISO(event.end_time), parseISO(event.start_time));
  const durationLabel = durationMins >= 60
    ? `${Math.floor(durationMins / 60)}h${durationMins % 60 > 0 ? ` ${durationMins % 60}m` : ""}`
    : `${durationMins}m`;

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => animateDismiss()}
    >
      {/* Backdrop */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => animateDismiss()} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: appColors.surface,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
        pointerEvents="box-none"
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: appColors.border }]} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.googleBadge, { backgroundColor: GOOGLE_BLUE + "18" }]}>
              <MaterialCommunityIcons name="google" size={13} color={GOOGLE_BLUE} />
              <Text style={[styles.googleBadgeText, { color: GOOGLE_BLUE }]}>Google Calendar</Text>
            </View>
            <Text style={[styles.title, { color: appColors.textPrimary }]} numberOfLines={2}>
              {event.title}
            </Text>
          </View>
          <Pressable hitSlop={8} onPress={() => animateDismiss()} style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={20} color={appColors.textTertiary} />
          </Pressable>
        </View>

        {/* Time info */}
        {!editing ? (
          <View style={styles.timeRow}>
            <MaterialCommunityIcons name="clock-outline" size={16} color={appColors.textSecondary} />
            <Text style={[styles.timeText, { color: appColors.textSecondary }]}>
              {format(parseISO(event.start_time), "EEE, MMM d · h:mm a")} – {format(parseISO(event.end_time), "h:mm a")}
            </Text>
            <Text style={[styles.durationChip, { backgroundColor: appColors.chipBg, color: appColors.textTertiary }]}>
              {durationLabel}
            </Text>
          </View>
        ) : (
          <View style={styles.editTimeSection}>
            {/* Start time */}
            <Pressable
              style={[styles.timePickerRow, { borderColor: appColors.border }]}
              onPress={() => {
                if (Platform.OS === "android") {
                  DateTimePickerAndroid.open({
                    value: startDate,
                    mode: "date",
                    onChange: (_, date) => {
                      if (!date) return;
                      // After date chosen, open time picker
                      DateTimePickerAndroid.open({
                        value: date,
                        mode: "time",
                        is24Hour: false,
                        onChange: (__, time) => {
                          if (!time) return;
                          setStartDate(time);
                          const duration = differenceInMinutes(endDate, startDate);
                          setEndDate(addMinutes(time, Math.max(duration, 15)));
                        },
                      });
                    },
                  });
                } else {
                  setShowStartPicker(true);
                  setShowEndPicker(false);
                }
              }}
            >
              <MaterialCommunityIcons name="clock-start" size={15} color={appColors.textSecondary} />
              <Text style={[styles.timePickerLabel, { color: appColors.textSecondary }]}>Start</Text>
              <Text style={[styles.timePickerValue, { color: appColors.textPrimary }]}>
                {format(startDate, "EEE, MMM d · h:mm a")}
              </Text>
            </Pressable>
            {Platform.OS === "ios" && showStartPicker && (
              <DateTimePicker
                value={startDate}
                mode="datetime"
                display="inline"
                onChange={(_, date) => {
                  if (date) {
                    setStartDate(date);
                    const duration = differenceInMinutes(endDate, startDate);
                    setEndDate(addMinutes(date, Math.max(duration, 15)));
                  }
                }}
              />
            )}

            {/* End time */}
            <Pressable
              style={[styles.timePickerRow, { borderColor: appColors.border }]}
              onPress={() => {
                if (Platform.OS === "android") {
                  DateTimePickerAndroid.open({
                    value: endDate,
                    mode: "date",
                    minimumDate: startDate,
                    onChange: (_, date) => {
                      if (!date) return;
                      DateTimePickerAndroid.open({
                        value: date,
                        mode: "time",
                        is24Hour: false,
                        onChange: (__, time) => {
                          if (time) setEndDate(time);
                        },
                      });
                    },
                  });
                } else {
                  setShowEndPicker(true);
                  setShowStartPicker(false);
                }
              }}
            >
              <MaterialCommunityIcons name="clock-end" size={15} color={appColors.textSecondary} />
              <Text style={[styles.timePickerLabel, { color: appColors.textSecondary }]}>End</Text>
              <Text style={[styles.timePickerValue, { color: appColors.textPrimary }]}>
                {format(endDate, "EEE, MMM d · h:mm a")}
              </Text>
            </Pressable>
            {Platform.OS === "ios" && showEndPicker && (
              <DateTimePicker
                value={endDate}
                mode="datetime"
                display="inline"
                minimumDate={startDate}
                onChange={(_, date) => {
                  if (date) setEndDate(date);
                }}
              />
            )}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {!editing ? (
            <Pressable
              style={[styles.actionButton, styles.secondaryButton, { borderColor: appColors.border }]}
              onPress={() => setEditing(true)}
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={appColors.textSecondary} />
              <Text style={[styles.actionButtonText, { color: appColors.textSecondary }]}>Reschedule</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={[styles.actionButton, styles.secondaryButton, { borderColor: appColors.border }]}
                onPress={() => { setEditing(false); setStartDate(parseISO(event.start_time)); setEndDate(parseISO(event.end_time)); }}
              >
                <Text style={[styles.actionButtonText, { color: appColors.textSecondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.primaryButton, { backgroundColor: GOOGLE_BLUE }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.actionButtonText, { color: "#fff" }]}>Save to Google</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  headerLeft: {
    flex: 1,
    gap: 6,
  },
  googleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  googleBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  closeButton: {
    padding: 4,
    marginTop: 2,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  timeText: {
    fontSize: 14,
    flex: 1,
  },
  durationChip: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  editTimeSection: {
    gap: 10,
    marginBottom: 20,
  },
  timePickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 12,
  },
  timePickerLabel: {
    fontSize: 13,
    fontWeight: "500",
    width: 38,
  },
  timePickerValue: {
    fontSize: 14,
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  primaryButton: {
    borderWidth: 0,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
