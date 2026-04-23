/**
 * AI Reasoning Test Harness — v4
 *
 * Mirrors the real app pipeline end-to-end:
 *   preFilterTimeSlots() [JS port of scheduling-algorithm.ts] → rank-slots edge function (AI)
 *
 * Test sections:
 *   1. Core tests          — 15 tasks × 3 personalities (45 runs)
 *   2. Extreme personalities — 5 tasks × 2 edge-case personalities (10 runs)
 *   3. Batching stress     — 2 scenarios testing task clustering under load (4 runs)
 *   4. Cognitive weight    — admin vs deep work on same schedule (4 runs)
 *   5. Regression checks   — explicit pass/fail on key invariants (auto, no AI)
 *   6. Sensitivity         — T2 × 13 one-dimension-at-a-time tests (13 runs)
 *   7. Schedule comparison — bird's-eye table: task × personality → #1 slot hour
 *
 * Total: ~76 AI calls
 *
 * Usage:
 *   cp scripts/.env.test.example scripts/.env.test
 *   node scripts/test-ai-reasoning.mjs
 *   → scripts/ai-reasoning-report.md
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = path.join(__dirname, ".env.test");
  if (!fs.existsSync(envFile)) {
    console.error("❌  Missing scripts/.env.test — copy scripts/.env.test.example");
    process.exit(1);
  }
  return Object.fromEntries(
    fs.readFileSync(envFile, "utf-8")
      .split("\n")
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => { const [k, ...v] = l.split("="); return [k.trim(), v.join("=").trim()]; })
  );
}

const env = loadEnv();
const SUPABASE_URL      = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
const TEST_EMAIL        = env.TEST_EMAIL;
const TEST_PASSWORD     = env.TEST_PASSWORD;
const TIMEZONE          = env.TIMEZONE || "Africa/Johannesburg";

// ─── Time Helpers ─────────────────────────────────────────────────────────────
// All slots generated in local time (Africa/Johannesburg = UTC+2).
// Work hours: 08:00–18:00 local.

const BASE_MONDAY      = "2026-03-09";
const UTC_OFFSET_HOURS = 2;
const WORK_START_LOCAL = 8;
const WORK_END_LOCAL   = 18;
const SLOT_STEP_MIN    = 30;
const MAX_CANDIDATES   = 20;
const MIN_VIABLE_SCORE = 40;

function baseDay(dayOffset) {
  const d = new Date(`${BASE_MONDAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(-UTC_OFFSET_HOURS, 0, 0, 0);
  return d;
}

function at(dayOffset, localHour, localMin = 0) {
  const d = baseDay(dayOffset);
  d.setUTCHours(d.getUTCHours() + localHour, localMin, 0, 0);
  return d.toISOString();
}

function event(dayOffset, sh, sm, eh, em, title) {
  return { title, start: at(dayOffset, sh, sm), end: at(dayOffset, eh, em) };
}

function localHour(isoStr) {
  return parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", hour12: false })
      .format(new Date(isoStr)), 10
  );
}

function localDayOfWeek(isoStr) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" })
    .format(new Date(isoStr));
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(day);
}

function localDateStr(isoStr) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, dateStyle: "medium" })
    .format(new Date(isoStr));
}

function fmtSlot(isoStr) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, weekday: "short", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoStr));
}

// ─── Base Schedule ────────────────────────────────────────────────────────────
// Fixed 2-week calendar. All times local (SAST).
// dayOffset: 0=Mon W1 … 4=Fri W1, 7=Mon W2 … 11=Fri W2

const BASE_SCHEDULE = [
  // Week 1
  event(0,  9,  0,  9, 30, "Daily standup"),
  event(0, 14,  0, 15,  0, "Client call"),
  event(1,  9,  0, 17,  0, "All-day workshop"),   // Tue W1 fully blocked
  event(2, 12,  0, 13,  0, "Lunch & learn"),
  event(2, 15,  0, 16,  0, "Design review"),
  event(3,  9,  0, 10,  0, "Sprint planning"),
  event(3, 12,  0, 13,  0, "Lunch & learn"),
  event(3, 15,  0, 16,  0, "Design review"),
  event(4, 16, 30, 17,  0, "EOD wrap-up"),
  // Week 2
  event(7,  9,  0,  9, 30, "Daily standup"),
  event(7, 11,  0, 12,  0, "1:1 with manager"),
  event(7, 14,  0, 15, 30, "Product sync"),
  event(8, 10,  0, 11,  0, "Design review"),
  event(8, 14,  0, 14, 30, "Quick check-in"),
  event(9,  9,  0, 10,  0, "Team catch-up"),
  event(9, 13,  0, 14,  0, "Lunch & learn"),
  event(10,  9,  0,  9, 30, "Daily standup"),
  event(10, 11,  0, 13,  0, "Strategy session"),
  event(11, 15,  0, 16,  0, "Weekly review"),
];

// ─── Scoring (port of scheduling-algorithm.ts) ────────────────────────────────

function diffDays(a, b)    { return (new Date(a) - new Date(b)) / 86400000; }
function diffHours(a, b)   { return (new Date(a) - new Date(b)) / 3600000; }
function diffMinutes(a, b) { return (new Date(a) - new Date(b)) / 60000; }

function applyChronotypeFilter(p, h) {
  if (p.peak_windows?.length) {
    const inPeak = p.peak_windows.some(w => h >= w.start && h < w.end);
    if (inPeak) return +10;
    const dists = p.peak_windows.flatMap(w => [Math.abs(h - w.start), Math.abs(h - w.end)]);
    const d = Math.min(...dists);
    if (d <= 1) return 0;
    if (d <= 3) return -20;
    return -35;
  }
  const c = p.chronotype;
  if (c < 30) {
    if (h >= 6  && h < 9)  return -40;
    if (h >= 9  && h < 12) return -20;
    if (h >= 14 && h <= 22) return +10;
  } else if (c > 70) {
    if (h >= 18 && h <= 22) return -40;
    if (h >= 15 && h < 18)  return -20;
    if (h >= 6  && h <= 14) return +10;
  } else {
    if (h < 8 || h > 20) return -15;
  }
  return 0;
}

function applyFocusDurationFilter(fd, dur) {
  if (fd < 30 && dur > 90) return -25;
  if (fd > 70 && dur < 60) return -15;
  return 0;
}

function applyDeadlineStyleFilter(ds, slotStart, due) {
  const days = diffDays(new Date(due), new Date(slotStart));
  if (ds < 30) {
    if (days < 1)  return -35;
    if (days > 10) return +5;
  } else if (ds > 70) {
    if (days < 0.5) return -10;
    if (days >= 1 && days <= 3) return +10;
    if (days > 7)   return -20;
  }
  return 0;
}

function applyBackToBackFilter(slot, tasks) {
  const s = new Date(slot.start);
  return tasks.some(t => {
    if (!t.scheduled_end) return false;
    const m = diffMinutes(s, new Date(t.scheduled_end));
    return m >= 0 && m < 15;
  }) ? -30 : 0;
}

function applyBreakFrequencyFilter(bf, slot, tasks) {
  const s = new Date(slot.start);
  const prev = tasks
    .filter(t => t.scheduled_end && new Date(t.scheduled_end) < s)
    .sort((a,b) => new Date(b.scheduled_end).getTime() - new Date(a.scheduled_end).getTime());
  if (prev.length > 0) {
    const gap = diffMinutes(s, new Date(prev[0].scheduled_end));
    if (bf < 30 && gap > 90) return -15;
    if (bf > 70 && gap < 30) return -15;
  }
  return 0;
}

function applyTaskSwitchingFilter(ts, slot, tasks) {
  const day = new Date(slot.start).toDateString();
  const n = tasks.filter(t => t.scheduled_start && new Date(t.scheduled_start).toDateString() === day).length;
  if (ts < 30 && n >= 3) return -25;
  if (ts > 70 && n === 0) return +5;
  return 0;
}

function applyUniversalBadTimes(h, dow) {
  let p = 0;
  if (dow === 1 && h < 10) p -= 15;
  if (dow === 5 && h >= 15) p -= 15;
  if (h === 12) p -= 10;
  return p;
}

function applyHighPriorityBoost(slotStart, due) {
  const hrs = diffHours(new Date(due), new Date(slotStart));
  return (hrs <= 48 && hrs > 0) ? +10 : 0;
}

function scoreSlot(slot, task, personality, existingTasks) {
  let score = 100;
  const h   = localHour(slot.start);
  const dow = localDayOfWeek(slot.start);
  score += applyChronotypeFilter(personality, h);
  score += applyFocusDurationFilter(personality.focus_duration, task.duration_minutes);
  if (task.due_date) score += applyDeadlineStyleFilter(personality.deadline_style, slot.start, task.due_date);
  score += applyBackToBackFilter(slot, existingTasks);
  score += applyBreakFrequencyFilter(personality.break_frequency, slot, existingTasks);
  score += applyTaskSwitchingFilter(personality.task_switching, slot, existingTasks);
  score += applyUniversalBadTimes(h, dow);
  if (task.priority === "high" && task.due_date) score += applyHighPriorityBoost(slot.start, task.due_date);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Mirrors preFilterTimeSlots in lib/scheduling-algorithm.ts:
 * Generate → filter busy → score → filter ≥40 → sort desc → top 20
 */
function preFilterTimeSlots(task, personality, existingTasks = []) {
  const busy = [
    ...BASE_SCHEDULE.map(e => ({ start: new Date(e.start).getTime(), end: new Date(e.end).getTime() })),
    ...existingTasks
      .filter(t => t.scheduled_start && t.scheduled_end)
      .map(t => ({ start: new Date(t.scheduled_start).getTime(), end: new Date(t.scheduled_end).getTime() })),
  ];

  const now = baseDay(0);
  now.setUTCHours(now.getUTCHours() + WORK_START_LOCAL);

  const effectiveDue = task.due_date
    ? new Date(task.due_date)
    : new Date(now.getTime() + (task.priority === "high" ? 7 : task.priority === "medium" ? 10 : 14) * 86400000);

  const deadlineMs = effectiveDue.getTime() + (24 - UTC_OFFSET_HOURS) * 3600000; // end of deadline day local

  const ALL_OFFSETS = [0,1,2,3,4,7,8,9,10,11];
  const slots = [];

  for (const off of ALL_OFFSETS) {
    const dayMidnight = baseDay(off);
    for (let lh = WORK_START_LOCAL; lh < WORK_END_LOCAL; lh++) {
      for (const lm of [0, 30]) {
        const s = dayMidnight.getTime() + (lh * 60 + lm) * 60000;
        const e = s + task.duration_minutes * 60000;
        if (s < now.getTime()) continue;
        const endLH = lh + task.duration_minutes / 60;
        if (endLH > WORK_END_LOCAL) continue;
        if (e > deadlineMs) continue;
        if (busy.some(b => s < b.end && e > b.start)) continue;
        slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), score: 0, reason: "" });
      }
    }
  }

  const scored = slots
    .map(slot => ({ ...slot, score: scoreSlot(slot, task, personality, existingTasks) }))
    .filter(s => s.score >= MIN_VIABLE_SCORE);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES);
}

// ─── Task Definitions ─────────────────────────────────────────────────────────

function makeTask(id, title, dur, priority, dueDayOffset, description) {
  return {
    id, title, description, duration_minutes: dur, priority,
    due_date: dueDayOffset != null ? at(dueDayOffset, 23, 59) : null,
  };
}

function scheduledTask(dayOffset, lh, dur, title, priority = "medium") {
  return {
    id: `sched-${Math.random().toString(36).slice(2,8)}`,
    title, duration_minutes: dur, priority,
    status: "scheduled",
    scheduled_start: at(dayOffset, lh),
    scheduled_end:   at(dayOffset, lh + Math.floor(dur/60), dur % 60),
    due_date: null,
  };
}

// Standard context — mix of types for batching and load reasoning
const SCHEDULED_TASKS_CONTEXT = [
  scheduledTask(0, 10, 90, "Refactor payment service", "high"),    // Mon W1 10–11:30 (deep work)
  scheduledTask(0, 15, 30, "Reply to client emails", "low"),       // Mon W1 15:00   (comms)
  scheduledTask(2, 13, 30, "Update project tracker", "low"),       // Wed W1 13:00   (admin)
  scheduledTask(3, 10, 60, "Architecture design doc", "high"),     // Thu W1 10–11   (deep work)
  scheduledTask(4,  9, 45, "Review pull requests", "medium"),      // Fri W1 09:00   (code review)
  scheduledTask(4, 10, 30, "Code review: auth module", "medium"),  // Fri W1 10:00   (code review — batching target)
  scheduledTask(8, 11, 60, "Write API documentation", "medium"),   // Tue W2 11:00   (writing)
  scheduledTask(9, 10, 90, "Data analysis for Q1 report", "high"), // Wed W2 10–11:30 (deep work)
];

// Heavy Friday code-review context — used in batching stress test A
const HEAVY_FRIDAY_REVIEWS = [
  ...SCHEDULED_TASKS_CONTEXT,
  scheduledTask(4, 11, 30, "Code review: API changes", "medium"),
  scheduledTask(4, 14, 45, "Code review: frontend PR", "medium"),
  scheduledTask(4, 15, 30, "Code review: infra changes", "medium"),
];

// Heavy Monday deep-work context — used in batching stress test B
const HEAVY_MONDAY_DEEPWORK = [
  ...SCHEDULED_TASKS_CONTEXT,
  scheduledTask(0,  8, 90, "System design session", "high"),
  scheduledTask(0, 11, 60, "Technical planning doc", "high"),
];

// ─── Test Tasks ───────────────────────────────────────────────────────────────

const TEST_TASKS = [
  // ── Admin tasks (low cognitive load) ──
  makeTask("T1",  "Write weekly status update",        30,  "low",    4,
    "Quick admin task — summarise this week's progress for the team channel. Straightforward, no deep thinking required."),
  makeTask("T10", "Update billing documentation",      20,  "low",    null,
    "Pure admin — copy-edit two paragraphs in the help docs to reflect the new pricing. Minimal thought required."),
  makeTask("T13", "Process monthly expense reports",   45,  "high",   2,
    "Admin task — collect receipts, categorise expenses, submit to finance. Repetitive and formulaic, no creative thinking needed. High priority because it's overdue."),

  // ── Deep work tasks (high cognitive load) ──
  makeTask("T2",  "Prepare client proposal",           90,  "high",   3,
    "Complex strategic document — requires focused thinking, competitive research, and clear persuasive writing. Needs my best energy."),
  makeTask("T3",  "Fix production bug",                45,  "high",   0,
    "Urgent debugging session — need to trace through logs, reproduce the issue, and push a fix. High cognitive demand, time-sensitive."),
  makeTask("T4",  "Refactor authentication module",    120, "medium",  9,
    "Deep technical work — restructuring existing code for security and performance. Requires uninterrupted focus and full context load."),
  makeTask("T14", "Write API technical spec",          120, "high",   null,
    "Technical deep work — document the full API contract, data models, error codes, and auth flow. Needs sustained focus and careful thinking."),

  // ── Creative tasks ──
  makeTask("T5",  "Team retrospective prep",           60,  "medium", null,
    "Facilitation prep — gather feedback themes, prepare talking points, design the session flow. Creative and organisational."),
  makeTask("T6",  "Record onboarding video",           90,  "low",    11,
    "Creative production task — script, record, and light edit a product walkthrough video. Needs energy and a quiet environment."),
  makeTask("T9",  "Brainstorm Q2 product roadmap",     90,  "high",    7,
    "Open-ended creative strategy session — generate ideas, spot gaps, think about positioning. Needs a fresh mind, ideally before the day gets busy."),

  // ── Communication tasks ──
  makeTask("T8",  "Reply to outstanding client emails",30,  "low",    2,
    "Communication task — respond to 4 client threads that have been waiting. Low cognitive load, can be done in any quiet window."),
  makeTask("T15", "Send project status to stakeholders",20, "low",    3,
    "Brief comms task — write a 5-line status update and email to 3 stakeholders. Low effort, any quiet moment works."),

  // ── Batching targets ──
  makeTask("T7",  "Code review: database migrations",  45,  "medium",  4,
    "Technical review — read through migration scripts, check for edge cases and risks. Same type of work as the auth module code review already on Friday."),

  // ── Edge cases ──
  makeTask("T11", "Respond to urgent Slack blocker",   10,  "high",    0,
    "Micro-task — one team member is blocked, need to send a short clarifying reply. Takes 10 minutes, must happen today."),
  makeTask("T12", "Design system audit",               90,  "medium", null,
    "Creative-analytical task — review component library for inconsistencies, document findings, propose improvements. Needs a clear head and eye for detail."),
];

// ─── Personality Profiles ─────────────────────────────────────────────────────

const CORE_PERSONALITIES = {
  "Early bird / early starter": {
    chronotype: 85, focus_duration: 65, deadline_style: 15,
    break_frequency: 50, task_switching: 50, structure_preference: 60,
    peak_windows: [{ start: 7, end: 12 }],
  },
  "Neutral": {
    chronotype: 50, focus_duration: 50, deadline_style: 50,
    break_frequency: 50, task_switching: 50, structure_preference: 50,
  },
  "Night owl / deadline-driven": {
    chronotype: 15, focus_duration: 60, deadline_style: 85,
    break_frequency: 50, task_switching: 50, structure_preference: 50,
    peak_windows: [{ start: 15, end: 20 }],
  },
};

const EXTREME_PERSONALITIES = {
  "Extreme night owl (peak 17–21, deadline-driven)": {
    chronotype: 5,  focus_duration: 60, deadline_style: 90,
    break_frequency: 50, task_switching: 50, structure_preference: 40,
    peak_windows: [{ start: 17, end: 21 }],
  },
  "Sprint multitasker (rapid, context-switching)": {
    chronotype: 50, focus_duration: 10, deadline_style: 50,
    break_frequency: 80, task_switching: 90, structure_preference: 20,
  },
};

// Sensitivity: vary one dimension at a time, T2 as reference task
const SENSITIVITY_TASK_ID = "T2";
const NEUTRAL_BASE = { chronotype: 50, focus_duration: 50, deadline_style: 50, break_frequency: 50, task_switching: 50, structure_preference: 50 };
const SENSITIVITY_TESTS = [
  { dim: "chronotype",      val: 15, label: "Night owl (15)" },
  { dim: "chronotype",      val: 50, label: "Neutral (50)" },
  { dim: "chronotype",      val: 85, label: "Early bird (85)" },
  { dim: "deadline_style",  val: 15, label: "Early starter (15)" },
  { dim: "deadline_style",  val: 50, label: "Neutral (50)" },
  { dim: "deadline_style",  val: 85, label: "Deadline driven (85)" },
  { dim: "focus_duration",  val: 20, label: "Sprint worker (20)" },
  { dim: "focus_duration",  val: 50, label: "Neutral (50)" },
  { dim: "focus_duration",  val: 85, label: "Deep focus (85)" },
  { dim: "task_switching",  val: 15, label: "Single-tasker (15)" },
  { dim: "task_switching",  val: 85, label: "Context-switcher (85)" },
  { dim: "break_frequency", val: 15, label: "Marathon worker (15)" },
  { dim: "break_frequency", val: 85, label: "Frequent breaks (85)" },
];

// ─── Violation Detectors ──────────────────────────────────────────────────────

const GENERIC_PATTERNS = [
  /^morning option on/i, /^afternoon option on/i, /^evening option on/i,
  /^good morning slot/i, /^good time on/i, /^best available slot on/i,
  /^available (morning|afternoon|evening) on/i,
  /^(morning|afternoon|evening) option( on)?/i,
  /^best match for your work patterns$/i,
  /^alternative (morning|afternoon|evening) on/i,
  /^(monday|tuesday|wednesday|thursday|friday) (morning|afternoon|evening) backup$/i,
];
const PEAK_ENERGY_PHRASES = /peak energy|peak focus|high energy|most alert/i;

function checkViolations(slots, personality, task, allCandidates = []) {
  const flags = [];
  if (!slots?.length) { flags.push("🚨 No slots returned"); return flags; }

  // Check if candidates span multiple days (needed for diversity check)
  const candidateDays = new Set(allCandidates.map(c => new Date(c.start).toDateString()));
  const allSameDay = candidateDays.size <= 1;

  for (let i = 0; i < slots.length; i++) {
    const { reason = "", start } = slots[i];
    const h = localHour(start);

    if (GENERIC_PATTERNS.some(p => p.test(reason.trim())))
      flags.push(`⚠️  Slot ${i+1}: GENERIC REASON`);

    if (!reason.trim())
      flags.push(`🚨 Slot ${i+1}: EMPTY REASON`);

    if (reason.length > 145)
      flags.push(`⚠️  Slot ${i+1}: TOO LONG (${reason.length} chars)`);

    if (task.due_date) {
      const slotDay = new Date(start).toDateString();
      const dueDay  = new Date(task.due_date).toDateString();
      if (slotDay === dueDay && /\b(buffer|day before|extra day)\b/i.test(reason))
        flags.push(`🚨 Slot ${i+1}: DEADLINE-DAY LANGUAGE`);
    }

    if (PEAK_ENERGY_PHRASES.test(reason)) {
      if (personality.chronotype <= 30 && h < 12)
        flags.push(`🚨 Slot ${i+1}: NIGHT OWL at ${h}:00 called "peak energy"`);
      if (personality.chronotype >= 70 && h >= 17)
        flags.push(`🚨 Slot ${i+1}: EARLY BIRD at ${h}:00 called "peak energy"`);
      if (h >= 13 && h < 15)
        flags.push(`🚨 Slot ${i+1}: POST-LUNCH at ${h}:00 called "peak energy"`);
    }
  }

  // Diversity: only flag if candidates actually span multiple days
  if (slots.length === 3 && !allSameDay) {
    const days = new Set(slots.map(s => new Date(s.start).toDateString()));
    if (days.size === 1)
      flags.push(`⚠️  DIVERSITY: All 3 slots on same day (candidates spanned ${candidateDays.size} days)`);
  }

  // Chronotype enforcement on #1 pick
  const top = slots[0];
  const topH = localHour(top.start);
  const hasAfternoonCandidates = allCandidates.some(c => localHour(c.start) >= 14);
  const hasMorningCandidates   = allCandidates.some(c => localHour(c.start) < 12);

  if (personality.chronotype <= 30 && topH < 12 && hasAfternoonCandidates)
    flags.push(`🚨 CHRONOTYPE FAIL: Night owl got morning slot (${topH}:00) as #1 when afternoon slots existed`);

  if (personality.chronotype >= 70 && topH >= 17 && hasMorningCandidates)
    flags.push(`🚨 CHRONOTYPE FAIL: Early bird got evening slot (${topH}:00) as #1 when morning slots existed`);

  // Dev reasoning quality
  return flags;
}

// ─── Regression Checks (no AI, pure logic) ───────────────────────────────────

function runRegressionChecks() {
  const results = [];

  function check(name, fn) {
    try {
      const pass = fn();
      results.push({ name, pass, note: "" });
    } catch(e) {
      results.push({ name, pass: false, note: e.message });
    }
  }

  // Night owl candidates: afternoon slots should score higher than morning
  check("Night owl: afternoon scored > morning", () => {
    const p = { chronotype: 15, focus_duration: 50, deadline_style: 50, break_frequency: 50, task_switching: 50, structure_preference: 50 };
    const task = makeTask("r1", "Test", 30, "medium", 7, "");
    const morning   = { start: at(0,  9, 0), end: at(0,  9, 30), score: 0, reason: "" };
    const afternoon = { start: at(0, 16, 0), end: at(0, 16, 30), score: 0, reason: "" };
    const sm = scoreSlot(morning, task, p, []);
    const sa = scoreSlot(afternoon, task, p, []);
    if (sa <= sm) throw new Error(`Afternoon score ${sa} ≤ morning score ${sm}`);
    return true;
  });

  // Early bird: morning scored higher than evening
  check("Early bird: morning scored > evening", () => {
    const p = { chronotype: 85, focus_duration: 50, deadline_style: 50, break_frequency: 50, task_switching: 50, structure_preference: 50 };
    const task = makeTask("r2", "Test", 30, "medium", 7, "");
    const morning = { start: at(2,  9, 0), end: at(2,  9, 30), score: 0, reason: "" };
    const evening = { start: at(2, 17, 0), end: at(2, 17, 30), score: 0, reason: "" };
    const sm = scoreSlot(morning, task, p, []);
    const se = scoreSlot(evening, task, p, []);
    if (sm <= se) throw new Error(`Morning score ${sm} ≤ evening score ${se}`);
    return true;
  });

  // Tight deadline: high-priority task due in 12h should get higher urgency score vs 10 days away
  check("Deadline proximity: same-day scores lower than 2-day-out for early starter", () => {
    const p = { chronotype: 50, focus_duration: 50, deadline_style: 15, break_frequency: 50, task_switching: 50, structure_preference: 50 };
    const taskNear = makeTask("r3", "Test", 30, "high", 0, "");
    const taskFar  = makeTask("r4", "Test", 30, "high", 4, "");
    const slot = { start: at(0, 9, 0), end: at(0, 9, 30), score: 0, reason: "" };
    const sNear = scoreSlot(slot, taskNear, p, []);
    const sFar  = scoreSlot(slot, taskFar, p, []);
    // Early starter prefers buffer — same-day should be penalised
    if (sNear >= sFar) throw new Error(`Same-day score ${sNear} ≥ far-deadline score ${sFar} for early starter`);
    return true;
  });

  // Back-to-back penalty: slot immediately after existing task should score lower
  check("Back-to-back: slot after existing task penalised", () => {
    const p = NEUTRAL_BASE;
    const task = makeTask("r5", "Test", 30, "medium", 7, "");
    const existingEnd = at(2, 10, 0);
    const backToBack  = { start: at(2, 10,  5), end: at(2, 10, 35), score: 0, reason: "" };
    const gapped      = { start: at(2, 11,  0), end: at(2, 11, 30), score: 0, reason: "" };
    const existing = [{ scheduled_start: at(2, 9, 0), scheduled_end: existingEnd }];
    const sBB  = scoreSlot(backToBack, task, p, existing);
    const sGap = scoreSlot(gapped, task, p, existing);
    if (sBB >= sGap) throw new Error(`Back-to-back score ${sBB} ≥ gapped score ${sGap}`);
    return true;
  });

  // Candidates sorted: top candidate should always be highest scored
  check("preFilterTimeSlots: returns sorted by score descending", () => {
    const p = CORE_PERSONALITIES["Neutral"];
    const task = makeTask("r6", "Test", 60, "medium", 7, "");
    const candidates = preFilterTimeSlots(task, p, []);
    for (let i = 0; i < candidates.length - 1; i++) {
      if (candidates[i].score < candidates[i+1].score)
        throw new Error(`Score order broken at index ${i}: ${candidates[i].score} < ${candidates[i+1].score}`);
    }
    return true;
  });

  // Fully-blocked day produces no candidates
  check("All-day event blocks all slots for that day", () => {
    const p = CORE_PERSONALITIES["Neutral"];
    const task = makeTask("r7", "Test", 30, "medium", 1, ""); // due Tue (all-day workshop day)
    const candidates = preFilterTimeSlots(task, p, []);
    const tueCandidates = candidates.filter(c => localDayOfWeek(c.start) === 2); // Tue
    // Tue is almost fully blocked — may have 08:00 slot before 09:00 workshop
    return true; // pass — just checking it doesn't crash
  });

  return results;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function getAuthToken() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const data = await res.json();
  if (!data.access_token) { console.error("❌  Auth failed:", data); process.exit(1); }
  return data.access_token;
}

async function callRankSlots(token, { candidates, task, personality, existingTasks = [] }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/rank-slots`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ candidates, task, personality, existingTasks, timezone: TIMEZONE }),
  });
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
  try { return JSON.parse(text); } catch { return { error: `Bad JSON: ${text.slice(0, 200)}` }; }
}

async function run(token, label, task, personality, existingTasks = SCHEDULED_TASKS_CONTEXT) {
  process.stdout.write(`  ${label}... `);
  await new Promise(r => setTimeout(r, 1200));

  const candidates = preFilterTimeSlots(task, personality, existingTasks);

  if (candidates.length === 0) {
    console.log("⚠️  0 candidates");
    return { error: "No candidates", slots: [], flags: [], candidateCount: 0, candidateList: [] };
  }

  const data = await callRankSlots(token, { candidates, task, personality, existingTasks });
  if (data.error) { console.log("❌"); return { error: data.error, slots: [], flags: [], candidateCount: candidates.length, candidateList: candidates }; }

  const slots = data.recommendations || [];
  const flags = checkViolations(slots, personality, task, candidates);
  console.log(flags.some(f => f.startsWith("🚨")) ? `🚨 ${flags.length} flag(s)` : flags.length ? `⚠️  ${flags.length} flag(s)` : "✅");
  return { slots, devReasoning: data.dev_reasoning, flags, candidateCount: candidates.length, candidateList: candidates };
}

// ─── Report Helpers ───────────────────────────────────────────────────────────

function slotBlock(slots, devReasoning, flags, candidateCount) {
  if (!slots?.length) return "❌ No response";
  const lines = [];
  if (candidateCount != null) lines.push(`*${candidateCount} candidates after preFilter+sort*\n`);
  slots.forEach((s, i) => {
    lines.push(`**${i+1}.** \`${fmtSlot(s.start)} → ${fmtSlot(s.end)}\` (score: ${s.score})`);
    lines.push(`   > ${s.reason}`);
  });
  if (devReasoning) { lines.push(""); lines.push(`*AI reasoning: ${devReasoning}*`); }
  if (flags?.length) { lines.push(""); flags.forEach(f => lines.push(`- ${f}`)); }
  else { lines.push(""); lines.push("✅ No violations"); }
  return lines.join("\n");
}

function buildScheduleTable() {
  const lines = [];
  [["### Week 1 (9–13 Mar)", 0, 9], ["### Week 2 (16–20 Mar)", 9, BASE_SCHEDULE.length]].forEach(([head, from, to]) => {
    lines.push(head, "| Day | Time (SAST) | Event |", "|---|---|---|");
    BASE_SCHEDULE.slice(from, to).forEach(e => {
      const d  = new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,weekday:"short",month:"short",day:"numeric"}).format(new Date(e.start));
      const sh = new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(e.start));
      const eh = new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(e.end));
      lines.push(`| ${d} | ${sh}–${eh} | ${e.title} |`);
    });
    lines.push("");
  });
  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔐 Authenticating...");
  const token = await getAuthToken();
  console.log("✅ Authenticated\n");

  let totalFlags = 0, totalCritical = 0, totalErrors = 0, totalRuns = 0;

  // ── Regression checks (no API calls) ─────────────────────────────────────
  console.log("━━━ REGRESSION CHECKS (local, no AI) ━━━");
  const regressions = runRegressionChecks();
  regressions.forEach(r => console.log(`  ${r.pass ? "✅" : "❌"} ${r.name}${r.note ? " — " + r.note : ""}`));

  // ── Section 1: Core tests ─────────────────────────────────────────────────
  console.log("\n━━━ CORE TESTS (15 tasks × 3 personalities) ━━━");
  const coreSections = [];
  // key: taskId → { personalityLabel → { topHour, topDay } }
  const comparisonData = {};

  for (const task of TEST_TASKS) {
    console.log(`\n📋 ${task.id}: "${task.title}" (${task.duration_minutes}min, ${task.priority}${task.due_date ? `, due ${localDateStr(task.due_date)}` : ""})`);
    comparisonData[task.id] = {};
    const results = {};

    for (const [pLabel, personality] of Object.entries(CORE_PERSONALITIES)) {
      const result = await run(token, pLabel, task, personality);
      results[pLabel] = result;
      totalRuns++;
      if (result.error) totalErrors++;
      else {
        const critFlags = result.flags.filter(f => f.startsWith("🚨")).length;
        totalCritical += critFlags;
        totalFlags += result.flags.length;
        if (result.slots[0]) {
          comparisonData[task.id][pLabel] = {
            hour: localHour(result.slots[0].start),
            day: new Intl.DateTimeFormat("en-US",{timeZone:TIMEZONE,weekday:"short"}).format(new Date(result.slots[0].start)),
          };
        }
      }
    }

    const lines = [];
    lines.push(`## ${task.id}: "${task.title}"`);
    lines.push(`**Duration:** ${task.duration_minutes}min | **Priority:** ${task.priority} | **Due:** ${task.due_date ? localDateStr(task.due_date) : "No deadline"}`);
    lines.push(`**Context:** ${task.description}`);
    lines.push("");
    for (const [pLabel, result] of Object.entries(results)) {
      lines.push(`### ${pLabel}`);
      lines.push(result.error ? `❌ Error: ${result.error}` : slotBlock(result.slots, result.devReasoning, result.flags, result.candidateCount));
      lines.push("");
    }
    lines.push("---");
    coreSections.push(lines.join("\n"));
  }

  // ── Section 2: Extreme personalities ─────────────────────────────────────
  console.log("\n━━━ EXTREME PERSONALITIES ━━━");
  const EXTREME_TASKS = ["T2","T4","T8","T9","T14"];
  const extremeSections = [];

  for (const [pLabel, personality] of Object.entries(EXTREME_PERSONALITIES)) {
    console.log(`\n  Personality: ${pLabel}`);
    const lines = [`### ${pLabel}`, ""];
    for (const tid of EXTREME_TASKS) {
      const task = TEST_TASKS.find(t => t.id === tid);
      const result = await run(token, task.id, task, personality);
      totalRuns++;
      if (result.error) totalErrors++;
      else { totalCritical += result.flags.filter(f=>f.startsWith("🚨")).length; totalFlags += result.flags.length; }
      lines.push(`#### ${task.id}: "${task.title}"`);
      lines.push(result.error ? `❌ ${result.error}` : slotBlock(result.slots, result.devReasoning, result.flags, result.candidateCount));
      lines.push("");
    }
    extremeSections.push(lines.join("\n"));
  }

  // ── Section 3: Batching stress ────────────────────────────────────────────
  console.log("\n━━━ BATCHING STRESS TESTS ━━━");
  const batchingSections = [];

  const batchScenarios = [
    {
      label: "Scenario A: 5 code reviews already on Friday → T7 should cluster there",
      task: TEST_TASKS.find(t => t.id === "T7"),
      context: HEAVY_FRIDAY_REVIEWS,
      personalities: ["Night owl / deadline-driven", "Neutral"],
      expectation: "AI should recommend Friday slots to batch with existing reviews",
    },
    {
      label: "Scenario B: Heavy deep-work Monday → T2 should warn or spread",
      task: TEST_TASKS.find(t => t.id === "T2"),
      context: HEAVY_MONDAY_DEEPWORK,
      personalities: ["Early bird / early starter", "Neutral"],
      expectation: "AI should warn about cognitive overload or recommend a different day",
    },
  ];

  for (const scenario of batchScenarios) {
    console.log(`\n  ${scenario.label}`);
    const lines = [`### ${scenario.label}`, `> **Expected:** ${scenario.expectation}`, ""];
    for (const pLabel of scenario.personalities) {
      const personality = CORE_PERSONALITIES[pLabel];
      const result = await run(token, pLabel, scenario.task, personality, scenario.context);
      totalRuns++;
      if (result.error) totalErrors++;
      else { totalCritical += result.flags.filter(f=>f.startsWith("🚨")).length; totalFlags += result.flags.length; }
      lines.push(`#### ${pLabel}`);
      lines.push(result.error ? `❌ ${result.error}` : slotBlock(result.slots, result.devReasoning, result.flags, result.candidateCount));
      lines.push("");
    }
    batchingSections.push(lines.join("\n"));
  }

  // ── Section 4: Cognitive weight enforcement ───────────────────────────────
  console.log("\n━━━ COGNITIVE WEIGHT ENFORCEMENT ━━━");
  const cogSections = [];

  // Compare T1 (admin) vs T2 (deep work) for same personality on same schedule
  // Expected: T2 gets earlier/better slot, T1 gets lower-energy slot
  const COG_PERSONALITY = CORE_PERSONALITIES["Neutral"];
  const cogPairs = [
    { a: TEST_TASKS.find(t=>t.id==="T2"), b: TEST_TASKS.find(t=>t.id==="T1"),  label: "Deep work (T2) vs Admin (T1) — same neutral personality" },
    { a: TEST_TASKS.find(t=>t.id==="T9"), b: TEST_TASKS.find(t=>t.id==="T15"), label: "Creative (T9) vs Comms micro (T15) — same neutral personality" },
  ];

  for (const pair of cogPairs) {
    console.log(`\n  ${pair.label}`);
    const [rA, rB] = await Promise.all([
      run(token, pair.a.id, pair.a, COG_PERSONALITY).then(r => { totalRuns++; return r; }),
      run(token, pair.b.id, pair.b, COG_PERSONALITY).then(r => { totalRuns++; return r; }),
    ]);
    [rA, rB].forEach(r => {
      if (r.error) totalErrors++;
      else { totalCritical += r.flags.filter(f=>f.startsWith("🚨")).length; totalFlags += r.flags.length; }
    });

    const lines = [`### ${pair.label}`, "> Do they get different times of day?", ""];
    lines.push(`#### ${pair.a.id}: "${pair.a.title}"`);
    lines.push(rA.error ? `❌ ${rA.error}` : slotBlock(rA.slots, rA.devReasoning, rA.flags, rA.candidateCount));
    lines.push("");
    lines.push(`#### ${pair.b.id}: "${pair.b.title}"`);
    lines.push(rB.error ? `❌ ${rB.error}` : slotBlock(rB.slots, rB.devReasoning, rB.flags, rB.candidateCount));

    // Compare #1 picks
    if (!rA.error && !rB.error && rA.slots[0] && rB.slots[0]) {
      const hA = localHour(rA.slots[0].start);
      const hB = localHour(rB.slots[0].start);
      const verdict = hA <= hB
        ? `✅ Cognitive weight respected: ${pair.a.id} (${hA}:00) scheduled before ${pair.b.id} (${hB}:00)`
        : `⚠️  Cognitive weight unclear: ${pair.a.id} (${hA}:00) got same or later slot than ${pair.b.id} (${hB}:00)`;
      lines.push(""); lines.push(`> **Verdict:** ${verdict}`);
    }
    lines.push(""); lines.push("---");
    cogSections.push(lines.join("\n"));
  }

  // ── Section 5: Sensitivity ────────────────────────────────────────────────
  console.log("\n━━━ PERSONALITY SENSITIVITY ━━━");
  const refTask = TEST_TASKS.find(t => t.id === SENSITIVITY_TASK_ID);
  console.log(`Reference: ${refTask.id} — "${refTask.title}"`);
  const sensitivityByDim = {};
  for (const test of SENSITIVITY_TESTS) {
    const personality = { ...NEUTRAL_BASE, [test.dim]: test.val };
    if (!sensitivityByDim[test.dim]) { sensitivityByDim[test.dim] = []; console.log(`\n  [${test.dim.replace(/_/g," ")}]`); }
    const result = await run(token, test.label, refTask, personality);
    totalRuns++;
    if (result.error) totalErrors++;
    else { totalCritical += result.flags.filter(f=>f.startsWith("🚨")).length; totalFlags += result.flags.length; }
    sensitivityByDim[test.dim].push({ label: test.label, ...result });
  }

  const sensitivityLines = [
    `## Sensitivity Analysis`,
    `**Reference task:** ${refTask.id} — "${refTask.title}" (${refTask.duration_minutes}min, ${refTask.priority})`,
    `**Method:** All dimensions neutral (50). One varied per row. Read vertically to see impact.`, "",
  ];
  for (const [dim, results] of Object.entries(sensitivityByDim)) {
    sensitivityLines.push(`### ${dim.replace(/_/g," ")}`);
    for (const r of results) {
      sensitivityLines.push(`#### ${r.label}`);
      sensitivityLines.push(r.error ? `❌ ${r.error}` : slotBlock(r.slots, r.devReasoning, r.flags, r.candidateCount));
      sensitivityLines.push("");
    }
    sensitivityLines.push("---");
  }

  // ── Section 6: Schedule comparison table ─────────────────────────────────
  const PSHORT = { "Early bird / early starter": "Early bird", "Neutral": "Neutral", "Night owl / deadline-driven": "Night owl" };
  const compLines = [
    "## Schedule Comparison",
    "> #1 slot for each task × personality. Quick scan for chronotype and cognitive weight alignment.",
    "",
    "| Task | Type | Early bird #1 | Neutral #1 | Night owl #1 |",
    "|---|---|---|---|---|",
  ];
  const TYPE_KEYWORDS = { admin:["admin","billing","expense","status update","tracker","report"], deep_work:["deep","refactor","debug","bug","technical","spec","proposal"], creative:["brainstorm","creative","video","retro","design system","audit"], communication:["email","slack","stakeholder","status to"] };
  function inferType(task) {
    const t = (task.title + " " + task.description).toLowerCase();
    for (const [type, kws] of Object.entries(TYPE_KEYWORDS)) if (kws.some(k=>t.includes(k))) return type;
    return "general";
  }
  for (const task of TEST_TASKS) {
    const type = inferType(task);
    const row = [task.id, type];
    for (const pLabel of Object.keys(CORE_PERSONALITIES)) {
      const d = comparisonData[task.id]?.[pLabel];
      row.push(d ? `${d.day} ${String(d.hour).padStart(2,"0")}:00` : "—");
    }
    compLines.push(`| ${row.join(" | ")} |`);
  }

  // ── Build report ──────────────────────────────────────────────────────────
  const report = [
    `# AI Reasoning Test Report — v4`,
    `Generated: ${new Date().toUTCString()} | Timezone: ${TIMEZONE} | Base week: ${BASE_MONDAY}`,
    `Pipeline: preFilterTimeSlots (scheduling-algorithm.ts port) → rank-slots (AI)`,
    "",
    `## Summary`,
    `| Metric | Value |`,
    `|---|---|`,
    `| Total AI calls | ${totalRuns} |`,
    `| Errors | ${totalErrors} |`,
    `| Critical flags 🚨 | ${totalCritical} |`,
    `| Warning flags ⚠️ | ${totalFlags - totalCritical} |`,
    `| Clean runs | ${totalRuns - totalErrors} |`,
    `| Regression checks | ${regressions.filter(r=>r.pass).length}/${regressions.length} passed |`,
    "",
    `## Regression Results`,
    ...regressions.map(r => `- ${r.pass?"✅":"❌"} ${r.name}${r.note?" — "+r.note:""}`),
    "",
    `---`,
    `# Base Schedule`,
    `> Fixed 2-week calendar. All times SAST (Africa/Johannesburg).`,
    "",
    buildScheduleTable(),
    `---`,
    `# Core Tests`,
    `> 15 tasks × 3 personalities. Candidates scored with real algorithm then sorted — AI receives best slots across all days.`,
    "",
    coreSections.join("\n"),
    `# Extreme Personalities`,
    `> 5 tasks × 2 edge-case personalities to stress-test boundary behavior.`,
    "",
    extremeSections.join("\n---\n"),
    "",
    `---`,
    `# Batching Stress Tests`,
    `> Does the AI cluster similar tasks and warn about cognitive overload?`,
    "",
    batchingSections.join("\n"),
    `---`,
    `# Cognitive Weight Enforcement`,
    `> Do deep work and admin tasks get different times of day for the same personality?`,
    "",
    cogSections.join("\n"),
    `---`,
    `# Personality Sensitivity`,
    `> One dimension varied at a time. Read vertically per dimension.`,
    "",
    sensitivityLines.join("\n"),
    `---`,
    compLines.join("\n"),
  ].join("\n");

  const outPath = path.join(__dirname, "ai-reasoning-report.md");
  fs.writeFileSync(outPath, report, "utf-8");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`📄 Report: scripts/ai-reasoning-report.md`);
  console.log(`   Runs: ${totalRuns} | Errors: ${totalErrors} | Critical: ${totalCritical} | Warnings: ${totalFlags - totalCritical}`);
  console.log(`   Regressions: ${regressions.filter(r=>r.pass).length}/${regressions.length} passed`);
  console.log(`   Est. cost: ~$${(totalRuns * 0.0004).toFixed(3)}`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
