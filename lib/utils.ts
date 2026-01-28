/**
 * TailoredTime - Utility Functions
 *
 * General-purpose helper functions used throughout the app.
 */

import { format, parse, isValid, addMinutes, isBefore, isAfter } from "date-fns";

/**
 * Format date to readable string
 * @param date - ISO 8601 string or Date object
 * @param formatString - date-fns format string (default: "MMM d, yyyy")
 * @returns Formatted date string or "Invalid date"
 */
export function formatDate(
  date: string | Date,
  formatString: string = "MMM d, yyyy",
): string {
  try {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (!isValid(dateObj)) return "Invalid date";
    return format(dateObj, formatString);
  } catch (error) {
    console.error("[formatDate]", error);
    return "Invalid date";
  }
}

/**
 * Format time to readable string
 * @param date - ISO 8601 string or Date object
 * @param use24Hour - Use 24-hour format (default: false)
 * @returns Formatted time string (e.g., "2:30 PM" or "14:30")
 */
export function formatTime(
  date: string | Date,
  use24Hour: boolean = false,
): string {
  try {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (!isValid(dateObj)) return "Invalid time";
    return format(dateObj, use24Hour ? "HH:mm" : "h:mm a");
  } catch (error) {
    console.error("[formatTime]", error);
    return "Invalid time";
  }
}

/**
 * Format duration in minutes to human-readable string
 * @param minutes - Duration in minutes
 * @returns Formatted string (e.g., "1h 30m", "45m")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${mins}m`;
}

/**
 * Calculate end time given start time and duration
 * @param start - ISO 8601 string or Date object
 * @param durationMinutes - Duration in minutes
 * @returns ISO 8601 string of end time
 */
export function calculateEndTime(
  start: string | Date,
  durationMinutes: number,
): string {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = addMinutes(startDate, durationMinutes);
  return endDate.toISOString();
}

/**
 * Parse HH:MM time string to minutes since midnight
 * @param timeString - Time in HH:MM format (e.g., "14:30")
 * @returns Minutes since midnight (e.g., 870 for 14:30)
 */
export function timeStringToMinutes(timeString: string): number {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to HH:MM string
 * @param minutes - Minutes since midnight
 * @returns Time string in HH:MM format
 */
export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Check if a time slot is in the past
 * @param start - ISO 8601 string or Date object
 * @returns True if time is in the past
 */
export function isPastTime(start: string | Date): boolean {
  const startDate = typeof start === "string" ? new Date(start) : start;
  return isBefore(startDate, new Date());
}

/**
 * Check if two time slots overlap
 * @param slot1Start - Start time of first slot
 * @param slot1End - End time of first slot
 * @param slot2Start - Start time of second slot
 * @param slot2End - End time of second slot
 * @returns True if slots overlap
 */
export function doTimeSlotsOverlap(
  slot1Start: string | Date,
  slot1End: string | Date,
  slot2Start: string | Date,
  slot2End: string | Date,
): boolean {
  const s1Start = typeof slot1Start === "string" ? new Date(slot1Start) : slot1Start;
  const s1End = typeof slot1End === "string" ? new Date(slot1End) : slot1End;
  const s2Start = typeof slot2Start === "string" ? new Date(slot2Start) : slot2Start;
  const s2End = typeof slot2End === "string" ? new Date(slot2End) : slot2End;

  // Slots overlap if:
  // - slot1 starts before slot2 ends AND
  // - slot1 ends after slot2 starts
  return isBefore(s1Start, s2End) && isAfter(s1End, s2Start);
}

/**
 * Truncate text to max length with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: 50)
 * @returns Truncated text with "..." if needed
 */
export function truncate(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Get initials from name
 * @param name - Full name
 * @returns Initials (e.g., "John Doe" -> "JD")
 */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);
}

/**
 * Debounce function (useful for search inputs)
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout>;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Sleep/delay helper (useful for testing)
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after ms
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// TODO: Add more utility functions as needed
