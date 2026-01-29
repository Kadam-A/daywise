/**
 * SchedulingModal - Shows AI recommendations or manual time picker
 *
 * For SMART scheduling:
 * - Displays top recommendation with score and reason
 * - "Show other times" reveals alternatives
 *
 * For MANUAL scheduling:
 * - Shows TimeSlotPicker component
 */

import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import {
  Text,
  Button,
  ActivityIndicator,
  Surface,
  ProgressBar,
  IconButton,
} from "react-native-paper";
import { TimeSlot, Task } from "../lib/types";
import TimeSlotPicker from "./TimeSlotPicker";

interface SchedulingModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectSlot: (slot: TimeSlot) => void;
  task: Task | null;
  slots: TimeSlot[];
  isLoading: boolean;
  error: string | null;
  schedulingMethod: "SMART" | "MANUAL";
  busySlots?: { start: string; end: string; title: string }[];
}

export default function SchedulingModal({
  visible,
  onClose,
  onSelectSlot,
  task,
  slots,
  isLoading,
  error,
  schedulingMethod,
  busySlots = [],
}: SchedulingModalProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  const topSlot = slots[0];
  const alternativeSlots = slots.slice(1);

  const handleConfirm = () => {
    if (selectedSlot) {
      onSelectSlot(selectedSlot);
    } else if (topSlot) {
      onSelectSlot(topSlot);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatTimeRange = (start: string, end: string) => {
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Surface style={styles.modal} elevation={5}>
          {/* Header */}
          <View style={styles.header}>
            <Text variant="titleLarge" style={styles.title}>
              {schedulingMethod === "SMART"
                ? "I Found Your Best Time"
                : "Select a Time"}
            </Text>
            <IconButton icon="close" size={24} onPress={onClose} />
          </View>

          {/* Loading State */}
          {isLoading && (
            <View style={[styles.content, styles.loadingContainer]}>
              <ActivityIndicator size="large" />
              <Text style={styles.loadingText}>
                {schedulingMethod === "SMART"
                  ? "Finding your perfect time..."
                  : "Loading available times..."}
              </Text>
            </View>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <View style={[styles.content, styles.errorContainer]}>
              <Text style={styles.errorText}>{error}</Text>
              <Button mode="outlined" onPress={onClose} style={styles.errorButton}>
                Try Again
              </Button>
            </View>
          )}

          {/* MANUAL Scheduling UI - NOT in ScrollView since TimeSlotPicker has its own */}
          {schedulingMethod === "MANUAL" && !isLoading && !error && (
            <View style={styles.manualContent}>
              <TimeSlotPicker
                task={task}
                busySlots={busySlots}
                onSelectSlot={onSelectSlot}
              />
            </View>
          )}

          {/* SMART Scheduling UI - uses ScrollView for alternatives list */}
          {schedulingMethod === "SMART" && !isLoading && !error && (
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              {topSlot ? (
                <>
                {/* Top Recommendation */}
                {!showAlternatives && (
                  <View style={styles.topRecommendation}>
                    <Text style={styles.dateText}>{formatDate(topSlot.start)}</Text>
                    <Text style={styles.timeText}>
                      {formatTimeRange(topSlot.start, topSlot.end)}
                    </Text>

                    {/* Score Bar */}
                    <View style={styles.scoreContainer}>
                      <ProgressBar
                        progress={topSlot.score / 100}
                        color="#4CAF50"
                        style={styles.scoreBar}
                      />
                      <Text style={styles.scoreText}>{topSlot.score}% match</Text>
                    </View>

                    {/* AI Reason */}
                    <Text style={styles.reasonText}>"{topSlot.reason}"</Text>

                    {/* Action Buttons */}
                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        onPress={handleConfirm}
                        style={styles.confirmButton}
                        icon="check"
                      >
                        Perfect!
                      </Button>
                      {alternativeSlots.length > 0 && (
                        <Button
                          mode="outlined"
                          onPress={() => setShowAlternatives(true)}
                          style={styles.alternativeButton}
                        >
                          Show other times
                        </Button>
                      )}
                    </View>
                  </View>
                )}

                {/* Alternative Slots */}
                {showAlternatives && (
                  <View style={styles.alternativesContainer}>
                    <Button
                      mode="text"
                      onPress={() => setShowAlternatives(false)}
                      icon="arrow-left"
                      style={styles.backButton}
                    >
                      Back to top pick
                    </Button>

                    {slots.map((slot, index) => (
                      <Pressable
                        key={index}
                        onPress={() => setSelectedSlot(slot)}
                        style={[
                          styles.slotCard,
                          selectedSlot === slot && styles.slotCardSelected,
                          index === 0 && styles.topSlotCard,
                        ]}
                      >
                        <View style={styles.slotHeader}>
                          <Text style={styles.slotDate}>{formatDate(slot.start)}</Text>
                          {index === 0 && (
                            <View style={styles.topBadge}>
                              <Text style={styles.topBadgeText}>Top Pick</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.slotTime}>
                          {formatTimeRange(slot.start, slot.end)}
                        </Text>
                        <View style={styles.slotScoreRow}>
                          <ProgressBar
                            progress={slot.score / 100}
                            color={index === 0 ? "#4CAF50" : "#2196F3"}
                            style={styles.slotScoreBar}
                          />
                          <Text style={styles.slotScore}>{slot.score}%</Text>
                        </View>
                        <Text style={styles.slotReason}>{slot.reason}</Text>
                      </Pressable>
                    ))}

                    <Button
                      mode="contained"
                      onPress={handleConfirm}
                      disabled={!selectedSlot}
                      style={styles.selectButton}
                    >
                      {selectedSlot
                        ? `Schedule at ${formatTime(selectedSlot.start)}`
                        : "Select a time"}
                    </Button>
                  </View>
                )}
                </>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyTitle}>No available times found</Text>
                  <Text style={styles.emptyText}>
                    Try extending your deadline or adjusting your work hours in settings.
                  </Text>
                  <Button mode="outlined" onPress={onClose}>
                    Close
                  </Button>
                </View>
              )}
            </ScrollView>
          )}
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "75%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  title: {
    fontWeight: "600",
  },
  content: {
    padding: 20,
  },
  manualContent: {
    flex: 1,
    padding: 20,
    paddingBottom: 0,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
    color: "#666",
  },
  errorContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  errorText: {
    color: "#f44336",
    textAlign: "center",
    marginBottom: 16,
  },
  errorButton: {
    marginTop: 8,
  },
  topRecommendation: {
    alignItems: "center",
    paddingVertical: 20,
  },
  dateText: {
    fontSize: 18,
    color: "#333",
    marginBottom: 4,
  },
  timeText: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1a1a1a",
    marginBottom: 16,
  },
  scoreContainer: {
    width: "100%",
    marginBottom: 16,
  },
  scoreBar: {
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  scoreText: {
    textAlign: "right",
    color: "#4CAF50",
    fontWeight: "600",
  },
  reasonText: {
    fontSize: 16,
    color: "#666",
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  buttonRow: {
    width: "100%",
    gap: 12,
  },
  confirmButton: {
    marginBottom: 8,
  },
  alternativeButton: {},
  alternativesContainer: {
    paddingBottom: 20,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  slotCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  slotCardSelected: {
    borderColor: "#2196F3",
    backgroundColor: "#E3F2FD",
  },
  topSlotCard: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E9",
  },
  slotHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  slotDate: {
    fontSize: 14,
    color: "#666",
  },
  topBadge: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  topBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  slotTime: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },
  slotScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  slotScoreBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  slotScore: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    width: 40,
  },
  slotReason: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
  },
  selectButton: {
    marginTop: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
});
