# TailoredTime Scheduling Algorithm & Task Types

**Decision Document for Claude Code Implementation**

Last Updated: January 20, 2026

---

## 📋 Task Types (Scheduling Methods)

We have **2 scheduling methods** to keep UX simple:

### 1. SMART Scheduling (AI-Powered)

**What it is:**
- AI automatically picks THE best time for the task
- Shows user the top recommendation with reasoning
- User can accept or see 2 more alternatives
- If all 3 rejected → Fallback to manual calendar picker

**When to use:**
- Flexible tasks (e.g., "Write proposal", "Review code")
- User trusts AI to find optimal time
- Task has no fixed time requirement

**User flow:**
```
1. Task created with scheduling_method: "SMART"
2. AI finds best time (1-2 seconds)
3. Show: "I picked Tuesday 2pm (95% match) - Peak focus time"
4. User clicks [Confirm] → Scheduled ✅
   OR
   User clicks [Show Other Times] → Shows alternatives 2 & 3
   → User picks one OR clicks [Pick from Calendar]
```

**Database fields:**
```typescript
{
  scheduling_method: "SMART",
  ai_score: 95,
  ai_reason: "Peak focus time with no meetings after"
}
```

---

### 2. MANUAL Scheduling (User-Controlled)

**What it is:**
- Skip AI completely
- User picks exact time from calendar interface
- No AI suggestions, no recommendations

**When to use:**
- Fixed appointments (e.g., "Dentist 5pm Saturday")
- Recurring meetings (e.g., "Team standup 9am Monday")
- User already knows exact time needed

**User flow:**
```
1. Task created with scheduling_method: "MANUAL"
2. Opens standard calendar picker immediately
3. User taps day → Sees available time slots
4. User taps time → Scheduled ✅
```

**Database fields:**
```typescript
{
  scheduling_method: "MANUAL",
  ai_score: null,
  ai_reason: null
}
```

---

## 🧮 Two-Stage Scheduling Algorithm

Our scheduling uses a **hybrid approach**: Algorithm pre-filtering + AI final ranking

### Why Hybrid?

- **Pure Algorithm:** Fast but not truly personalized
- **Pure AI:** Slow, expensive, can be overwhelmed by too many options
- **Hybrid (Our Choice):** Fast pre-filtering (algorithm) + smart final picks (AI)

---

## Stage 1: Pre-Filtering Algorithm

**Goal:** Narrow 100+ slots down to ~15-20 viable candidates for AI

**Input:**
- All available time slots (next 14 days)
- Task details (duration, deadline, priority)
- User personality profile
- Existing scheduled tasks
- Calendar events (busy times)

**Output:**
- Top 15-20 candidate slots (scored 40-100)
- Removes obviously bad slots

**Process:**
1. Start each slot with score = 100
2. Apply penalties for bad matches
3. Filter out slots with score < 40
4. Sort by score (descending)
5. Return top 20 (or all if < 20)

---

### Pre-Filtering Rules

#### 1. Chronotype Filter (Most Important)

**Night Owl (chronotype 0-30):**
- Peak: 2pm-10pm
- Penalty -40: 6am-9am (very early morning)
- Penalty -20: 9am-12pm (morning not ideal)
- Bonus +10: 2pm-10pm (afternoon/evening)

**Early Bird (chronotype 70-100):**
- Peak: 6am-2pm
- Penalty -40: 6pm-10pm (late evening)
- Penalty -20: 3pm-6pm (afternoon fatigue)
- Bonus +10: 6am-2pm (morning)

**Neutral (chronotype 31-69):**
- Penalty -15: Before 8am or after 8pm (extremes)

#### 2. Focus Duration Filter

**Short Sprints (focus_duration 0-30):**
- Ideal: 25-45 min tasks
- Penalty -25: Task > 90 minutes (too long)

**Deep Focus (focus_duration 70-100):**
- Ideal: 90-180 min tasks
- Penalty -15: Task < 60 minutes (too short)

#### 3. Deadline Pressure Filter

**Early Starter (deadline_style 0-30):**
- Prefers: 7+ days before deadline
- Penalty -35: < 1 day until deadline (too close)
- Bonus +5: > 10 days until deadline (plenty of buffer)

**Deadline Driven (deadline_style 70-100):**
- Prefers: 1-3 days before deadline
- Penalty -10: < 0.5 days until deadline (dangerously close)
- Penalty -20: > 7 days until deadline (too far)
- Bonus +10: 1-3 days until deadline (sweet spot)

#### 4. Back-to-Back Task Filter (Universal)

- Check if any existing task ends < 15 minutes before slot
- Penalty -30: Back-to-back scheduling (bad for everyone)

#### 5. Break Timing Filter

**Frequent Breaks (break_frequency 0-30):**
- Ideal: Task every 25-45 minutes
- Penalty -15: Gap > 90 minutes since last task

**Rare Breaks (break_frequency 70-100):**
- Ideal: Task every 2-3 hours
- Penalty -15: Gap < 30 minutes since last task (insufficient break)

#### 6. Task Switching Filter

**Single-Tasker (task_switching 0-30):**
- Prefers: 1-2 tasks per day
- Penalty -25: ≥ 3 tasks already scheduled same day

**Comfortable Switcher (task_switching 70-100):**
- Can handle: 4+ tasks per day
- Bonus +5: First task of day
- No penalty for multiple tasks

#### 7. Universal Bad Times (Everyone)

- **Monday morning fog:** -15 (Monday before 10am)
- **Friday afternoon fatigue:** -15 (Friday after 3pm)
- **Lunch time conflict:** -10 (task spans 12pm-1pm)
- **Weekend:** -20 (if no weekend work hours set)

#### 8. High Priority Boost

- Bonus +10: High priority task + slot within 48 hours

---

### Pre-Filtering Code Structure

```typescript
function preFilterSlots(
  availableSlots: TimeSlot[],
  task: Task,
  userProfile: UserProfile,
  existingTasks: Task[]
): TimeSlot[] {
  
  const scored = availableSlots.map(slot => ({
    slot,
    score: calculateScore(slot, task, userProfile, existingTasks),
    penalties: [] // for debugging
  }));
  
  // Filter minimum viable score
  const viable = scored.filter(s => s.score >= 40);
  
  // Sort descending
  viable.sort((a, b) => b.score - a.score);
  
  // Return top 20
  return viable.slice(0, 20).map(s => s.slot);
}

function calculateScore(slot, task, userProfile, existingTasks) {
  let score = 100;
  
  // Apply all filters above
  // ... chronotype filter
  // ... focus duration filter
  // ... deadline pressure filter
  // ... etc
  
  return Math.max(0, Math.min(100, score)); // Clamp 0-100
}
```

---

## Stage 2: AI Final Ranking

**Goal:** Pick the 3 BEST slots from the 15-20 candidates

**Why AI here:**
- Candidates are all "viable" (score 40-100)
- AI focuses on NUANCED factors
- AI provides personalized reasoning
- AI considers context we didn't code

**Input:**
- 15-20 pre-filtered candidate slots
- Task details
- User personality summary
- Existing scheduled tasks (for context)

**Output:**
- Top 3 slots with scores (0-100) and reasons

---

### AI Prompt Structure

```
You are a scheduling AI. Pick the TOP 3 time slots for this task.

IMPORTANT: All candidates below are already VIABLE. Your job is to rank 
them based on SUBTLE, PERSONAL factors.

USER PROFILE:
- Chronotype: 85/100 (Early Bird - most alert in mornings)
- Focus Style: 75/100 (Prefers long 2-3 hour deep work blocks)
- Deadline Behavior: 25/100 (Starts early with buffer time)
- Break Frequency: 80/100 (Prefers rare breaks, long work sessions)
- Task Switching: 15/100 (Single-tasker - prefers 1-2 tasks per day)

TASK:
- Title: "Write proposal"
- Duration: 120 minutes
- Priority: high
- Deadline: January 25, 2026

CANDIDATE SLOTS (20 slots):
0. Tuesday Jan 21, 10:00 AM - 12:00 PM
1. Tuesday Jan 21, 2:00 PM - 4:00 PM
2. Wednesday Jan 22, 9:00 AM - 11:00 AM
... (up to 20)

CONTEXT:
Existing tasks on same days:
- Tuesday Jan 21: Team meeting 3:00 PM - 4:00 PM
- Wednesday Jan 22: (no tasks)

Consider:
1. Energy levels at this time for this user
2. How this fits with their other scheduled tasks
3. Deadline timing preferences
4. Whether they'll be in the right "mode" for this task
5. Any subtle factors that make one slot better than another

Return ONLY JSON with exactly 3 slots:
{
  "recommendations": [
    {
      "slotIndex": 2,
      "score": 95,
      "reason": "Morning energy matches your early bird style, full 2-hour block before any meetings"
    },
    {
      "slotIndex": 0,
      "score": 92,
      "reason": "Also morning but closer to existing meeting might create transition stress"
    },
    {
      "slotIndex": 1,
      "score": 88,
      "reason": "Afternoon slot, still productive but after your peak energy"
    }
  ]
}
```

---

### AI Call Implementation

```typescript
// supabase/functions/rank-slots/index.ts

import OpenAI from 'openai';
import { z } from 'zod';

const ResponseSchema = z.object({
  recommendations: z.array(z.object({
    slotIndex: z.number().int().min(0),
    score: z.number().int().min(0).max(100),
    reason: z.string().max(150)
  })).min(1).max(3)
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a scheduling assistant. Always return valid JSON.' },
    { role: 'user', content: prompt }
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "slot_recommendations",
      strict: true,
      schema: jsonSchema
    }
  },
  temperature: 0.3,
  max_tokens: 500
});

// Parse and validate
const parsed = JSON.parse(response.choices[0].message.content);
const validated = ResponseSchema.parse(parsed);

// Map back to actual slots
const recommendations = validated.recommendations
  .filter(rec => rec.slotIndex < candidates.length)
  .map(rec => ({
    ...candidates[rec.slotIndex],
    score: rec.score,
    reason: rec.reason
  }));

return recommendations.slice(0, 3);
```

---

### AI Cost Analysis

**Per request:**
- Input: ~400 tokens (personality + 20 candidates)
- Output: ~200 tokens (3 recommendations)
- Total: ~600 tokens

**Cost with GPT-4o-mini:**
- $0.150 per 1M input tokens
- $0.600 per 1M output tokens
- **Per request: $0.00018**

**At scale:**
- 10,000 users × 10 tasks/week = 40,000 requests/month
- 60% use SMART (24,000 AI calls)
- 40% use MANUAL (0 AI calls)
- **Monthly cost: $4.32**

**At 100,000 users:** $43.20/month

---

## 🔄 Missed Task Handling

### Auto-Reschedule Feature

**Database field:**
```typescript
auto_reschedule: boolean
```

**Two behaviors:**

#### 1. Auto-Reschedule = TRUE

**What happens:**
- Background job runs every hour
- Detects tasks where: `now > scheduled_start AND status = 'scheduled'`
- Automatically runs scheduling algorithm again
- Picks new best time
- Updates task with new time
- Sends push notification: "Task rescheduled to Tuesday 2pm"

**User experience:**
- Task missed at 10am
- By 11am, task auto-moved to tomorrow 10am
- User gets notification
- Task stays in "scheduled" status

**Use case:**
- Flexible tasks user wants to complete eventually
- "Write report", "Review code", "Plan project"

#### 2. Auto-Reschedule = FALSE

**What happens:**
- Background job detects missed task
- Marks status as "overdue"
- Sends push notification: "You missed 'Team meeting'. Reschedule?"
- Task shows in red on home screen
- User must manually reschedule

**User experience:**
- Task missed at 2pm
- Task marked overdue
- Shows in "Overdue Tasks" section (red)
- User clicks "Reschedule" → AI suggests 3 new times OR manual picker

**Use case:**
- Fixed appointments that can't auto-reschedule
- "Dentist appointment", "Team standup"

---

### Background Job Implementation

**Supabase Edge Function + Cron:**

```typescript
// supabase/functions/check-missed-tasks/index.ts

// Runs every hour via pg_cron
// SELECT cron.schedule('check-missed-tasks', '0 * * * *', $$..$$);

const now = new Date().toISOString();

// Find missed tasks
const { data: missedTasks } = await supabase
  .from('tasks')
  .select('*')
  .eq('status', 'scheduled')
  .lt('scheduled_start', now);

for (const task of missedTasks) {
  if (task.auto_reschedule) {
    // AUTO-RESCHEDULE
    const newSlots = await findNewSlot(task);
    
    if (newSlots.length > 0) {
      await supabase
        .from('tasks')
        .update({
          scheduled_start: newSlots[0].start,
          scheduled_end: newSlots[0].end,
          status: 'scheduled'
        })
        .eq('id', task.id);
      
      await sendNotification(task.user_id, {
        title: 'Task Rescheduled',
        body: `"${task.title}" moved to ${formatTime(newSlots[0].start)}`
      });
    } else {
      // No slots available - mark overdue
      await markAsOverdue(task);
    }
  } else {
    // MARK AS OVERDUE
    await supabase
      .from('tasks')
      .update({ status: 'overdue' })
      .eq('id', task.id);
    
    await sendNotification(task.user_id, {
      title: 'Task Overdue',
      body: `You missed "${task.title}". Reschedule?`
    });
  }
}
```

---

## 📱 Complete User Flows

### Flow 1: SMART Scheduling

```
1. User creates task "Write proposal"
2. Selects: ● Let AI pick best time
3. Clicks [Create Task]
   ↓
4. Loading: "Finding your best time..." (1-2 sec)
   ↓
5. Shows: "✨ I Picked Your Best Time"
   - Tuesday 2pm - 4pm
   - 95% Match
   - "Peak focus time with no meetings after"
   - [Show Other Times] [Confirm]
   ↓
6a. User clicks [Confirm] → Task scheduled ✅ → Home screen
   
6b. User clicks [Show Other Times]
   ↓
7. Shows: "Other Good Times"
   - 🥇 Tuesday 2pm (95%)
   - 🥈 Wednesday 10am (92%)
   - 🥉 Thursday 3pm (89%)
   - [Pick from Calendar]
   ↓
8a. User picks one → Task scheduled ✅ → Home screen
   
8b. User clicks [Pick from Calendar]
   ↓
9. Shows calendar picker → User picks time → Scheduled ✅
```

### Flow 2: MANUAL Scheduling

```
1. User creates task "Dentist appointment"
2. Selects: ● I'll pick the time myself
3. Clicks [Create Task]
   ↓
4. Shows calendar picker immediately (no loading)
   ↓
5. User taps Saturday Jan 25
   ↓
6. Shows time slots for that day:
   - 3:00 PM 🟢
   - 4:00 PM 🟢
   - 5:00 PM 🟢 ← User taps
   - 6:00 PM 🟢
   ↓
7. User clicks [Schedule at 5:00 PM]
   ↓
8. Task scheduled ✅ → Home screen
```

---

## 🗄️ Database Schema

### tasks table

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Task details
  title VARCHAR(200) NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 5 AND duration_minutes <= 480),
  priority VARCHAR(10) NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date TIMESTAMPTZ,
  
  -- Scheduling
  scheduling_method VARCHAR(10) NOT NULL CHECK (scheduling_method IN ('SMART', 'MANUAL')),
  auto_reschedule BOOLEAN NOT NULL DEFAULT true,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending_schedule', 'scheduled', 'completed', 'overdue', 'cancelled')),
  
  -- AI metadata (only for SMART method)
  ai_score INTEGER CHECK (ai_score >= 0 AND ai_score <= 100),
  ai_reason VARCHAR(150),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_scheduled_times CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL) OR
    (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  )
);

-- RLS policies
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tasks"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_scheduled_start ON tasks(scheduled_start);
CREATE INDEX idx_tasks_user_scheduled ON tasks(user_id, scheduled_start) WHERE status = 'scheduled';
```

---

## 🎯 Implementation Priority

### Week 1: Core Scheduling
- [ ] Task creation UI (with 2 scheduling method options)
- [ ] Pre-filtering algorithm (all 8 filters)
- [ ] AI ranking Edge Function
- [ ] SMART scheduling screen (show top 1, then alternatives)
- [ ] MANUAL scheduling screen (calendar picker)

### Week 2: User Experience
- [ ] Calendar picker component
- [ ] Task card components (different statuses)
- [ ] Home screen with scheduled tasks
- [ ] Loading states and error handling

### Week 3: Missed Tasks
- [ ] Background job Edge Function
- [ ] Auto-reschedule logic
- [ ] Mark as overdue logic
- [ ] Overdue tasks UI (red cards)
- [ ] Push notifications

### Week 4: Polish
- [ ] Onboarding (personality quiz)
- [ ] Settings (edit personality, work hours)
- [ ] Analytics tracking
- [ ] Testing and bug fixes

---

## 🔧 Configuration & Tuning

### Adjustable Parameters

**Pre-filtering:**
```typescript
const MIN_VIABLE_SCORE = 40; // Lower = more permissive
const MAX_CANDIDATES = 20; // How many to send to AI
const LOOK_AHEAD_DAYS = 14; // Search window
```

**Penalty values:** (in calculateScore function)
- Adjust if too harsh or too lenient
- Monitor filtering stats to tune

**AI prompt:**
- Adjust temperature (0.3 = consistent, 0.7 = creative)
- Adjust max_tokens (500 = detailed reasons)

---

## 📊 Monitoring & Analytics

### Track these metrics:

**Scheduling success:**
- % tasks successfully scheduled (SMART vs MANUAL)
- Average time to schedule
- AI recommendation acceptance rate

**Pre-filtering effectiveness:**
- Average candidates after filtering
- % tasks with 0 candidates (needs manual)
- Most common penalties applied

**AI performance:**
- API success rate
- Average response time
- Cost per task

**User behavior:**
- SMART vs MANUAL usage ratio
- "Show other times" click rate
- Manual fallback rate

---

## 🚨 Error Handling

### Scenarios to handle:

**No available slots:**
- Message: "No available times in next 2 weeks"
- Action: Suggest extending work hours OR manual pick from any time

**AI fails:**
- Fallback: Use top 3 pre-filtered candidates with generic reasons
- Log error for monitoring
- User sees: "Here are 3 good times for you"

**Pre-filter returns < 3 candidates:**
- If 0: Go straight to manual
- If 1-2: AI ranks those only, show what we have
- If 3+: Normal flow

**Task missed + no reschedule slots:**
- Mark as overdue
- Notify user: "Cannot auto-reschedule, please pick time manually"

---

## 💡 Key Design Decisions

1. **Two scheduling methods (not three):** Keeps UX simple, clear choice
2. **Hybrid algorithm:** Fast pre-filter + smart AI picks = best of both
3. **Top 3 alternatives:** Enough choice, not overwhelming
4. **Manual fallback always available:** Never trap user in AI flow
5. **Auto-reschedule optional:** User controls rescheduling behavior
6. **Cost-optimized:** 60/40 split SMART/MANUAL saves ~40% on AI costs

---

END OF DOCUMENT
