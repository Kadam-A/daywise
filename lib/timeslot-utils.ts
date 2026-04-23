/**
 * timeslot-utils.ts — Pure time slot logic for manual scheduling
 *
 * Extracted from TimeSlotPicker for testability.
 * No React Native dependencies — plain TypeScript only.
 */

export interface BusySlot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
  title: string;
}

export interface PartialConflict {
  title: string;
  startMin: number;  // minute within the hour the conflict starts (0–59)
  endMin: number;    // minute within the hour the conflict ends (0–60)
}

export interface HourSlot {
  hour: number;                       // 0–23
  label: string;                      // e.g. "11:00 PM"
  status: "available" | "busy";
  busyReason?: string;
  busyMinutes: number[];              // which of [0,15,30,45] are blocked by a busy slot
  bleeds: boolean;                    // true when task end crosses midnight
  partialConflicts: PartialConflict[]; // busy slots that partially overlap this hour
}

/**
 * Converts hour 0–23 to a 12-hour AM/PM string.
 * Never produces "13:00 PM" or similar — uses modulo normalisation.
 */
export const formatHour = (hour: number): string => {
  const h = ((hour % 24) + 24) % 24; // normalise to 0–23 regardless of input
  const period = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:00 ${period}`;
};

/**
 * Formats a time range using real Date arithmetic.
 * Handles midnight crossover — appends "(next day)" when end is on the following calendar day.
 *
 * @param startHour     0–23, the selected start hour
 * @param selectedDate  The selected calendar date (time components ignored)
 * @param durationMinutes  Task duration in minutes
 * @param startMinute   0–59, the selected start minute (default 0)
 */
export const formatTimeRange = (
  startHour: number,
  selectedDate: Date,
  durationMinutes: number,
  startMinute: number = 0
): string => {
  const start = new Date(selectedDate);
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  const fmt = (d: Date): string => {
    const h = d.getHours();
    const m = d.getMinutes();
    const period = h >= 12 ? "PM" : "AM";
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const mins = m === 0 ? "00" : String(m).padStart(2, "0");
    return `${display}:${mins} ${period}`;
  };

  const crossesMidnight = end.toDateString() !== start.toDateString();
  return crossesMidnight
    ? `${fmt(start)} – ${fmt(end)} (next day)`
    : `${fmt(start)} – ${fmt(end)}`;
};

/**
 * Returns true when a task starting at startHour:startMinute would end after midnight.
 */
export const taskBleeds = (startHour: number, durationMinutes: number, startMinute: number = 0): boolean =>
  startHour * 60 + startMinute + durationMinutes >= 24 * 60;

/**
 * Generates 24 hour slots (12:00 AM through 11:00 PM) for the given date.
 * - Slots in the past are marked busy with reason "Past"
 * - Slots overlapping a busy period are marked busy with the event title
 * - bleeds flag indicates the task would run past midnight from that slot
 */
export const generateHourSlots = (
  selectedDate: Date,
  busySlots: BusySlot[],
  durationMinutes: number
): HourSlot[] => {
  const now = new Date();

  const MINUTES = [0, 15, 30, 45];

  return Array.from({ length: 24 }, (_, hour) => {
    const hourStart = new Date(selectedDate);
    hourStart.setHours(hour, 0, 0, 0);

    // Check each minute option — mark busy if in the past OR overlaps a busy slot
    const busyMinutes = MINUTES.filter((m) => {
      const slotStart = new Date(selectedDate);
      slotStart.setHours(hour, m, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

      if (slotStart <= now) return true; // already started or passed

      return busySlots.some((b) => {
        const busyStart = new Date(b.start);
        const busyEnd = new Date(b.end);
        return slotStart < busyEnd && slotEnd > busyStart;
      });
    });

    // The whole hour slot is busy only if EVERY minute option is blocked
    const allMinutesBusy = busyMinutes.length === MINUTES.length;

    let status: "available" | "busy" = "available";
    let busyReason: string | undefined;

    if (allMinutesBusy) {
      status = "busy";
      // Determine reason — past or a real conflict
      const firstSlotStart = new Date(selectedDate);
      firstSlotStart.setHours(hour, 0, 0, 0);
      if (firstSlotStart <= now) {
        busyReason = "Past";
      } else {
        const slotEnd = new Date(firstSlotStart.getTime() + durationMinutes * 60_000);
        const conflicting = busySlots.find((b) => {
          const busyStart = new Date(b.start);
          const busyEnd = new Date(b.end);
          return firstSlotStart < busyEnd && slotEnd > busyStart;
        });
        busyReason = conflicting?.title;
      }
    }

    // Collect conflicts — all busy slots that touch this hour (shown as subtitles in the UI)
    const partialConflicts: PartialConflict[] = status !== "busy"
      ? busySlots
          .filter((b) => {
            const busyStart = new Date(b.start);
            const busyEnd = new Date(b.end);
            const hourEnd = new Date(selectedDate);
            hourEnd.setHours(hour + 1, 0, 0, 0);
            return busyStart < hourEnd && busyEnd > hourStart;
          })
          .map((b) => {
            const busyStart = new Date(b.start);
            const busyEnd = new Date(b.end);
            const startMin = busyStart < hourStart ? 0 : busyStart.getMinutes();
            const rawEnd = busyEnd.getHours() > hour || busyEnd.getDate() !== hourStart.getDate() ? 60 : busyEnd.getMinutes();
            return { title: b.title, startMin, endMin: rawEnd };
          })
          .sort((a, b) => a.startMin - b.startMin)
      : [];

    return {
      hour,
      label: formatHour(hour),
      status,
      busyReason,
      busyMinutes,
      bleeds: taskBleeds(hour, durationMinutes),
      partialConflicts,
    };
  });
};
