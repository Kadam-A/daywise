/**
 * TimeSlotPicker - Manual time slot selection
 *
 * Shows a week view with available/busy time slots.
 * User can pick any available slot for their task.
 */

import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { Text, Button, Chip } from "react-native-paper";
import { Task, TimeSlot } from "../lib/types";

interface BusySlot {
  start: string;
  end: string;
  title: string;
}

interface TimeSlotPickerProps {
  task: Task | null;
  busySlots: BusySlot[];
  onSelectSlot: (slot: TimeSlot) => void;
}

interface DayOption {
  date: Date;
  label: string;
  shortLabel: string;
}

interface HourSlot {
  hour: number;
  label: string;
  status: "available" | "busy" | "partial";
  busyReason?: string;
}

// Helper function - defined outside component to avoid hoisting issues
const formatHour = (hour: number): string => {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:00 ${period}`;
};

export default function TimeSlotPicker({
  task,
  busySlots,
  onSelectSlot,
}: TimeSlotPickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedHour, setSelectedHour] = useState<number | null>(null);

  // Generate next 7 days
  const dayOptions: DayOption[] = useMemo(() => {
    const days: DayOption[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const isToday = i === 0;
      const isTomorrow = i === 1;

      days.push({
        date,
        label: isToday
          ? "Today"
          : isTomorrow
          ? "Tomorrow"
          : date.toLocaleDateString("en-US", { weekday: "long" }),
        shortLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
      });
    }

    return days;
  }, []);

  // Generate hour slots for selected day (5 AM - 11 PM)
  // Wide range so users can pick any time - algorithm handles preferences
  const hourSlots: HourSlot[] = useMemo(() => {
    const slots: HourSlot[] = [];
    const taskDuration = task?.duration_minutes || 60;

    for (let hour = 5; hour <= 23; hour++) {
      const slotStart = new Date(selectedDate);
      slotStart.setHours(hour, 0, 0, 0);

      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + taskDuration);

      // Check if slot overlaps with any busy slot
      const overlappingBusy = busySlots.find((busy) => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return slotStart < busyEnd && slotEnd > busyStart;
      });

      // Check if slot is in the past
      const now = new Date();
      const isPast = slotStart < now;

      let status: "available" | "busy" | "partial" = "available";
      let busyReason: string | undefined;

      if (isPast) {
        status = "busy";
        busyReason = "Past";
      } else if (overlappingBusy) {
        status = "busy";
        busyReason = overlappingBusy.title;
      }

      slots.push({
        hour,
        label: formatHour(hour),
        status,
        busyReason,
      });
    }

    return slots;
  }, [selectedDate, busySlots, task?.duration_minutes]);

  const handleSelectSlot = () => {
    if (selectedHour === null || !task) return;

    const start = new Date(selectedDate);
    start.setHours(selectedHour, 0, 0, 0);

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + task.duration_minutes);

    const slot: TimeSlot = {
      start: start.toISOString(),
      end: end.toISOString(),
      score: 70, // Default score for manual selection
      reason: "Manually selected time",
    };

    onSelectSlot(slot);
  };

  const formatSelectedTime = (): string => {
    if (selectedHour === null) return "";
    const endHour = selectedHour + Math.ceil((task?.duration_minutes || 60) / 60);
    return `${formatHour(selectedHour)} - ${formatHour(endHour)}`;
  };

  return (
    <View style={styles.container}>
      {/* Date Selection */}
      <Text style={styles.sectionTitle}>Select Date</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dateScroll}
        contentContainerStyle={styles.dateScrollContent}
      >
        {dayOptions.map((day, index) => {
          const isSelected =
            selectedDate.toDateString() === day.date.toDateString();
          return (
            <Pressable
              key={index}
              onPress={() => {
                setSelectedDate(day.date);
                setSelectedHour(null);
              }}
              style={[styles.dateChip, isSelected && styles.dateChipSelected]}
            >
              <Text
                style={[
                  styles.dateChipDay,
                  isSelected && styles.dateChipTextSelected,
                ]}
              >
                {day.shortLabel}
              </Text>
              <Text
                style={[
                  styles.dateChipDate,
                  isSelected && styles.dateChipTextSelected,
                ]}
              >
                {day.date.getDate()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Time Selection */}
      <Text style={styles.sectionTitle}>Select Time</Text>
      <Text style={styles.durationHint}>
        Task duration: {task?.duration_minutes || 60} min
      </Text>

      <ScrollView style={styles.timeScroll} showsVerticalScrollIndicator={false}>
        {hourSlots.map((slot) => {
          const isSelected = selectedHour === slot.hour;
          const isDisabled = slot.status === "busy";

          return (
            <Pressable
              key={slot.hour}
              onPress={() => !isDisabled && setSelectedHour(slot.hour)}
              disabled={isDisabled}
              style={[
                styles.timeSlot,
                isSelected && styles.timeSlotSelected,
                isDisabled && styles.timeSlotDisabled,
              ]}
            >
              <View style={styles.timeSlotLeft}>
                <View
                  style={[
                    styles.statusDot,
                    slot.status === "available" && styles.statusAvailable,
                    slot.status === "busy" && styles.statusBusy,
                  ]}
                />
                <Text
                  style={[
                    styles.timeSlotText,
                    isSelected && styles.timeSlotTextSelected,
                    isDisabled && styles.timeSlotTextDisabled,
                  ]}
                >
                  {slot.label}
                </Text>
              </View>
              <Text
                style={[
                  styles.statusText,
                  slot.status === "available" && styles.statusTextAvailable,
                  slot.status === "busy" && styles.statusTextBusy,
                ]}
              >
                {slot.status === "available"
                  ? "Available"
                  : slot.busyReason || "Busy"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Confirm Button */}
      <View style={styles.footer}>
        <Button
          mode="contained"
          onPress={handleSelectSlot}
          disabled={selectedHour === null}
          style={styles.confirmButton}
        >
          {selectedHour !== null
            ? `Schedule at ${formatSelectedTime()}`
            : "Select a time slot"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#333",
  },
  dateScroll: {
    marginBottom: 24,
  },
  dateScrollContent: {
    gap: 8,
  },
  dateChip: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
    minWidth: 60,
  },
  dateChipSelected: {
    backgroundColor: "#2196F3",
  },
  dateChipDay: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  dateChipDate: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  dateChipTextSelected: {
    color: "#fff",
  },
  durationHint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  timeScroll: {
    maxHeight: 300,
  },
  timeSlot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: "#f8f8f8",
  },
  timeSlotSelected: {
    backgroundColor: "#E3F2FD",
    borderWidth: 2,
    borderColor: "#2196F3",
  },
  timeSlotDisabled: {
    backgroundColor: "#fafafa",
    opacity: 0.7,
  },
  timeSlotLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusAvailable: {
    backgroundColor: "#4CAF50",
  },
  statusBusy: {
    backgroundColor: "#f44336",
  },
  timeSlotText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  timeSlotTextSelected: {
    color: "#2196F3",
    fontWeight: "600",
  },
  timeSlotTextDisabled: {
    color: "#999",
  },
  statusText: {
    fontSize: 14,
  },
  statusTextAvailable: {
    color: "#4CAF50",
  },
  statusTextBusy: {
    color: "#999",
  },
  footer: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  confirmButton: {},
});
