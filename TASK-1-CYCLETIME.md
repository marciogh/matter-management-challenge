# Task 1: Implement Cycle Time Tracking & SLA Calculation

## Overview
Implement the `CycleTimeService` to calculate resolution times and SLA status for matters, then display these values in the frontend table with color-coded badges.

## Requirements Summary
- Calculate resolution time from first status transition to "Done" status
- For in-progress matters, calculate ongoing duration (from first transition to now)
- Determine SLA status: "In Progress", "Met" (≤8h), or "Breached" (>8h)
- Format durations human-readable (e.g., "2h 30m", "3d 5h")
- Display in frontend with color-coded SLA badges (Blue/Green/Red)

---

## Backend Implementation

### File: `backend/src/ticketing/matter/service/cycle_time_service.ts`

#### 1. Add Database Pool Import
```typescript
import pool from '../../../db/pool.js';
```

#### 2. Implement `calculateCycleTimeAndSLA` Method
Use PostgreSQL `FILTER` clause to efficiently get all needed data in a single query:
```sql
SELECT
  MIN(tcth.transitioned_at) AS started_at,
  MIN(tcth.transitioned_at) FILTER (WHERE tfsg.name = 'Done') AS completed_at
FROM ticketing_cycle_time_histories tcth
JOIN ticketing_field_status_options tfso ON tcth.to_status_id = tfso.id
JOIN ticketing_field_status_groups tfsg ON tfso.group_id = tfsg.id
WHERE tcth.ticket_id = $1
```

**Why FILTER clause?**
- Extracts both `started_at` and `completed_at` in a single query
- `MIN` extracts the first transition timestamp
- `FILTER (WHERE tfsg.name = 'Done')` applies condition only to the "Done" aggregate
- More efficient than multiple subqueries or fetching all rows to filter in code

Logic:
- `startedAt`: First transition in history (MIN of all transitions)
- `completedAt`: First transition to "Done" group status (MIN with FILTER)
- If `completedAt` is null: matter is in progress
- Calculate `resolutionTimeMs`:
  - If completed: `completedAt - startedAt`
  - If in progress: `now - startedAt`

#### 3. Implement `_formatDuration` Method
Format milliseconds into human-readable string:
- Days (d), hours (h), minutes (m)
- Examples: "2h 30m", "3d 5h", "45m"
- For in-progress: return the duration (the frontend shows "In Progress" status separately)

#### 4. Implement SLA Determination
```typescript
if (currentStatusGroupName !== 'Done') {
  return 'In Progress';
} else if (resolutionTimeMs <= this._slaThresholdMs) {
  return 'Met';
} else {
  return 'Breached';
}
```

### Edge Cases to Handle
- No history records (new matter with no transitions) → return N/A values
- Matter has transitions but never reached "Done" → In Progress
- Matter completed in < 1 minute → show "< 1m"

---

## Frontend Implementation

### File: `frontend/src/components/MatterTable.tsx`

#### 1. Display Resolution Time Column (line ~170-172)
Replace placeholder with:
```tsx
<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
  {matter.cycleTime?.resolutionTimeFormatted || 'N/A'}
</td>
```

#### 2. Display SLA Column with Color-Coded Badge (line ~174-178)
```tsx
<td className="px-6 py-4 whitespace-nowrap">
  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getSLABadgeColor(matter.sla)}`}>
    {matter.sla || 'N/A'}
  </span>
</td>
```

#### 3. Add SLA Badge Color Helper
Add to `frontend/src/utils/formatting.ts` or inline:
```typescript
export function getSLABadgeColor(sla: string | undefined): string {
  switch (sla) {
    case 'Met':
      return 'bg-green-100 text-green-800';
    case 'Breached':
      return 'bg-red-100 text-red-800';
    case 'In Progress':
    default:
      return 'bg-blue-100 text-blue-800';
  }
}
```

#### 4. Remove "(TODO)" Markers
Remove the `<span className="text-xs text-orange-600 ml-2">(TODO)</span>` from both column headers.

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/ticketing/matter/service/cycle_time_service.ts` | Implement full service logic |
| `frontend/src/components/MatterTable.tsx` | Display cycle time & SLA columns |
| `frontend/src/utils/formatting.ts` | Add `getSLABadgeColor` helper |

---

## Verification Plan

1. **Start the application**:
   ```bash
   docker compose up
   ```

2. **Verify backend**:
   - Open http://localhost:3000/api/v1/matters
   - Verify `cycleTime` and `sla` fields are populated in the JSON response
   - Check that `resolutionTimeFormatted` shows human-readable durations

3. **Verify frontend**:
   - Open http://localhost:8080
   - Verify Resolution Time column shows durations (e.g., "2h 30m", "3d 5h")
   - Verify SLA column shows colored badges:
     - Blue badge for "In Progress"
     - Green badge for "Met"
     - Red badge for "Breached"

4. **Test edge cases**:
   - Find matters in different states (Done, In Progress, To Do)
   - Verify N/A is shown appropriately for matters without history

---

## Unit Testing Strategy

### Why Unit Tests Are Effective for CycleTimeService

The `CycleTimeService` has **pure logic** that can be tested without a database:
1. **Duration formatting** (`_formatDuration`) - pure function, no DB needed
2. **SLA determination** - pure logic based on timestamps and threshold
3. **Cycle time calculation** - can mock DB results and test logic

### Testing Approach: Extract Pure Functions

**Key Insight**: Separate database queries from business logic to enable pure unit tests.

#### Refactored Structure for Testability
```typescript
// Pure functions - easily unit testable
export function formatDuration(durationMs: number): string { ... }
export function determineSLA(resolutionTimeMs: number | null, isCompleted: boolean, thresholdMs: number): SLAStatus { ... }
export function calculateResolutionTime(startedAt: Date | null, completedAt: Date | null): number | null { ... }

// Class method handles DB query + calls pure functions
class CycleTimeService {
  async calculateCycleTimeAndSLA(...) {
    const { startedAt, completedAt } = await this._queryTransitions(ticketId);
    const resolutionTimeMs = calculateResolutionTime(startedAt, completedAt);
    const sla = determineSLA(resolutionTimeMs, isCompleted, this._slaThresholdMs);
    return { cycleTime, sla };
  }
}
```

### Test File: `backend/src/ticketing/matter/__tests__/cycle_time_service.test.ts`

#### 1. Duration Formatting Tests (Pure Unit Tests)
```typescript
describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe('2h 30m');
  });

  it('formats days and hours', () => {
    expect(formatDuration(3 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000)).toBe('3d 5h');
  });

  it('handles less than 1 minute', () => {
    expect(formatDuration(30 * 1000)).toBe('< 1m');
  });

  it('handles zero duration', () => {
    expect(formatDuration(0)).toBe('< 1m');
  });
});
```

#### 2. SLA Determination Tests (Pure Unit Tests)
```typescript
describe('determineSLA', () => {
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

  it('returns "In Progress" when not completed', () => {
    expect(determineSLA(null, false, EIGHT_HOURS_MS)).toBe('In Progress');
  });

  it('returns "Met" when resolved within threshold', () => {
    expect(determineSLA(7 * 60 * 60 * 1000, true, EIGHT_HOURS_MS)).toBe('Met');
  });

  it('returns "Met" when resolved exactly at threshold', () => {
    expect(determineSLA(EIGHT_HOURS_MS, true, EIGHT_HOURS_MS)).toBe('Met');
  });

  it('returns "Breached" when resolved over threshold', () => {
    expect(determineSLA(9 * 60 * 60 * 1000, true, EIGHT_HOURS_MS)).toBe('Breached');
  });
});
```

#### 3. Resolution Time Calculation Tests (Pure Unit Tests)
```typescript
describe('calculateResolutionTime', () => {
  it('returns null when no start time', () => {
    expect(calculateResolutionTime(null, null)).toBeNull();
  });

  it('calculates time between start and completion', () => {
    const start = new Date('2025-01-01T10:00:00Z');
    const end = new Date('2025-01-01T12:30:00Z');
    expect(calculateResolutionTime(start, end)).toBe(2.5 * 60 * 60 * 1000);
  });

  it('calculates ongoing time when not completed', () => {
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago
    const result = calculateResolutionTime(start, null);
    expect(result).toBeGreaterThanOrEqual(3 * 60 * 60 * 1000);
  });
});
```

#### 4. Integration Test (Optional - With DB Mock)
```typescript
describe('CycleTimeService.calculateCycleTimeAndSLA', () => {
  it('returns N/A for matter with no history', async () => {
    // Mock pool.query to return empty results
    vi.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });

    const service = new CycleTimeService();
    const result = await service.calculateCycleTimeAndSLA('ticket-id', null);

    expect(result.cycleTime.resolutionTimeFormatted).toBe('N/A');
    expect(result.sla).toBe('In Progress');
  });
});
```

### Test Coverage Goals

| Component | Test Type | Coverage |
|-----------|-----------|----------|
| `formatDuration` | Pure unit test | 100% - all duration ranges |
| `determineSLA` | Pure unit test | 100% - all 3 SLA states |
| `calculateResolutionTime` | Pure unit test | Edge cases: null, completed, ongoing |
| Full service flow | Integration/mock | Happy path + edge cases |

### Benefits of This Approach

1. **No database needed** for core logic tests - fast, reliable
2. **Deterministic** - no time-dependent failures (mock `Date.now()` for ongoing calculations)
3. **High coverage** - pure functions are easy to test exhaustively
4. **Maintainable** - tests document expected behavior clearly

### Run Tests
```bash
cd backend
npm test                    # Run all tests
npm run test:coverage       # Run with coverage report
```

---

## Implementation Order
1. Backend `cycle_time_service.ts` - implement full logic with extracted pure functions
2. Backend `__tests__/cycle_time_service.test.ts` - add unit tests
3. Frontend `formatting.ts` - add SLA badge color helper
4. Frontend `MatterTable.tsx` - update display columns
