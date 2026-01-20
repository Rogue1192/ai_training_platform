# Implementation Plan: Real-Time Training Progress UI

## Overview

This document outlines the implementation plan for improving the training session UI to show real-time progress, live elapsed time, and better visibility into what's currently happening during training.

---

## Current State Analysis

### What We Have Now
1. **Elapsed Time Display**: Shows "7d 23h" format - only updates on page refresh
2. **Progress Counter**: Shows "2/5" iterations - only updates on page refresh
3. **Phase Indicator**: Shows "Baseline Test", "Training", "Evaluation" badges
4. **Stuck Badge**: Shows "Possibly Stuck" for sessions with no update >1 hour
5. **Last Update Timestamp**: Shows when session was last updated

### User Pain Points
1. **Static elapsed time** - Shows "7d 23h" but doesn't tick, so users can't tell if it's still running
2. **No real-time feedback** - Users have to manually refresh to see progress
3. **No visibility into current activity** - Can't see what the system is currently doing
4. **Uncertainty about stuck sessions** - Hard to tell if a session is actually working or stuck

---

## Proposed Improvements

### Feature 1: Live Elapsed Time Counter (Ticking Clock)

**Problem**: Current elapsed time only updates on page refresh

**Solution**: Implement a real-time ticking counter that updates every second for in-progress sessions

**Implementation Details**:
- Create a `LiveTimer` component that uses `useEffect` with `setInterval`
- Timer updates every 1 second for in-progress sessions
- Display format: `7d 23h 45m 32s` (showing seconds)
- Only tick for `in_progress` status sessions
- Clean up interval on unmount or status change

**Code Location**: 
- New component: `client/src/components/LiveTimer.tsx`
- Integration: `client/src/pages/TrainingSessions.tsx`

**Estimated Effort**: 1-2 hours

---

### Feature 2: Real-Time Progress Updates (Auto-Refresh)

**Problem**: Progress counter (e.g., "2/5 iterations") only updates on manual refresh

**Solution**: Implement automatic polling to refresh session data periodically

**Implementation Details**:
- Add `refetchInterval` option to the tRPC query (e.g., every 10-15 seconds)
- Only enable auto-refresh when there are in-progress sessions
- Add visual indicator showing "Auto-refreshing" status
- Consider using WebSocket/SSE for true real-time updates (future enhancement)

**Code Changes**:
```typescript
const { data: sessions, isLoading, refetch } = trpc.training.list.useQuery(undefined, {
  refetchInterval: hasInProgressSessions ? 10000 : false, // 10 seconds
});
```

**Estimated Effort**: 30 minutes

---

### Feature 3: Activity Status Dialog/Panel

**Problem**: Users can't see what's currently happening during training

**Solution**: Add an expandable activity panel showing current training activity

**Implementation Details**:

#### Option A: Activity Log Panel (Simpler)
- Add collapsible "Activity Log" section to each in-progress session card
- Show last 5-10 activity entries with timestamps
- Activities: "Starting baseline test...", "Sending prompt to Claude...", "Analyzing response...", "Iteration 3 complete"

#### Option B: Live Activity Modal (More Detailed)
- "View Live Activity" button on in-progress sessions
- Opens modal showing:
  - Current phase and iteration
  - Live streaming of AI conversation (if possible)
  - Recent activity log
  - Estimated time remaining

**Backend Requirements**:
- Add `activityLog` field to training sessions (array of recent activities)
- Update worker to log activities during execution
- Consider Redis pub/sub for real-time activity streaming (advanced)

**Database Schema Addition**:
```sql
ALTER TABLE "trainingSessions" ADD COLUMN "activityLog" json DEFAULT '[]';
```

**Estimated Effort**: 
- Option A: 3-4 hours
- Option B: 6-8 hours (includes backend changes)

---

### Feature 4: Progress Bar with Percentage

**Problem**: "2/5 iterations" is less visual than a progress bar

**Solution**: Add a visual progress bar alongside the text counter

**Implementation Details**:
- Use existing `<Progress>` component from shadcn/ui
- Show percentage: `40% (2/5 iterations)`
- Color-code by phase:
  - Baseline: Blue
  - Training: Yellow/Orange
  - Evaluation: Green

**Code Location**: 
- Integration in session card: `client/src/pages/TrainingSessions.tsx`

**Estimated Effort**: 30 minutes

---

### Feature 5: Estimated Time Remaining

**Problem**: Users don't know how long training will take

**Solution**: Calculate and display estimated completion time

**Implementation Details**:
- Track average time per iteration
- Calculate: `(total_iterations - current_progress) * avg_time_per_iteration`
- Display: "~2h 30m remaining" or "ETA: 3:45 PM"
- Show "Calculating..." until enough data points

**Backend Requirements**:
- Track `avgIterationTime` in session or calculate from conversation timestamps

**Estimated Effort**: 2-3 hours

---

## Database Errors to Address

### Current Issues Found

1. **Session ID 20 (API Key Validation Test)**: 
   - Status: error
   - Error: Database insert failure (missing columns - NOW FIXED)
   
2. **Session ID 21 (Kitsap Roof Pros)**:
   - Status: in_progress
   - Progress: 2/5
   - Last Update: -291 minutes ago (negative = future? timezone issue)
   - This session appears to be running but the "last update" time looks wrong

3. **Multiple stuck sessions** (IDs 19, 11, 9):
   - All timed out with "no progress for 84+ hours"
   - These were caused by the database schema issue (now fixed)

### Recommended Actions

1. **Clean up old error sessions**: Delete or archive sessions that failed due to the schema issue
2. **Fix timezone handling**: Investigate why "Last Update" shows negative minutes
3. **Add database health check**: Verify schema matches Drizzle definitions on startup

---

## Implementation Priority

### Phase 1: Quick Wins (1-2 hours total)
1. ✅ Live Elapsed Time Counter (ticking clock)
2. ✅ Auto-refresh for in-progress sessions
3. ✅ Visual progress bar

### Phase 2: Activity Visibility (3-4 hours)
4. Activity Log Panel (Option A)
5. Estimated time remaining

### Phase 3: Advanced Features (Future)
6. Live Activity Modal with streaming
7. WebSocket-based real-time updates
8. Email notifications for completion/errors

---

## Technical Considerations

### Performance
- Auto-refresh should be smart (only when in-progress sessions exist)
- Live timer should use `requestAnimationFrame` or efficient intervals
- Consider debouncing/throttling for activity log updates

### User Experience
- Don't overwhelm with too much information
- Make activity details expandable/collapsible
- Ensure mobile responsiveness

### Backend Impact
- Activity logging adds database writes
- Consider rate limiting activity log entries
- May need Redis for high-frequency updates

---

## Summary

| Feature | Effort | Impact | Priority |
|---------|--------|--------|----------|
| Live Elapsed Timer | 1-2h | High | P1 |
| Auto-Refresh | 30m | High | P1 |
| Progress Bar | 30m | Medium | P1 |
| Activity Log Panel | 3-4h | High | P2 |
| ETA Calculation | 2-3h | Medium | P2 |
| Live Activity Modal | 6-8h | High | P3 |

**Total Estimated Time for P1 Features**: ~2-3 hours
**Total Estimated Time for P1+P2 Features**: ~6-8 hours
