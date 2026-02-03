# Task 2: Implement Column Sorting

## Overview
Extend the Matter Management table to support sorting by all columns. Currently only `created_at` and `updated_at` are sortable on the backend, and only "Subject" has a click handler on the frontend. This task adds sorting support for all 10 columns across all field types stored in the EAV pattern.

## Requirements Summary
- Sort by all column types: text, number, date, boolean, currency, user, select, status
- Sort computed fields: Resolution Time and SLA (from Task 1)
- Handle NULL values consistently (NULLS LAST)
- Resolve field names to UUIDs for EAV joins
- Add sort click handlers to all frontend column headers
- Validate sort parameters on the backend

---

## Backend Implementation

### New File: `backend/src/ticketing/matter/utils/sort_field_mapper.ts`

Map frontend `sortBy` values to database sorting configuration:

```typescript
export interface SortFieldConfig {
  type: 'ticket_column' | 'text_field' | 'number_field' | 'date_field'
      | 'boolean_field' | 'currency_field' | 'user_field' | 'select_field'
      | 'status_field' | 'computed_cycle_time' | 'computed_sla';
  fieldName?: string;      // Name in ticketing_fields table
  valueColumn?: string;    // Column in ticketing_ticket_field_value
  directColumn?: string;   // Column in ticketing_ticket (for ticket_column type)
}

export const SORT_FIELD_MAP: Record<string, SortFieldConfig> = {
  // Direct ticket table columns
  'created_at':      { type: 'ticket_column', directColumn: 'created_at' },
  'updated_at':      { type: 'ticket_column', directColumn: 'updated_at' },

  // EAV field-based sorting
  'subject':         { type: 'text_field',     fieldName: 'subject',        valueColumn: 'text_value' },
  'Case Number':     { type: 'number_field',   fieldName: 'Case Number',    valueColumn: 'number_value' },
  'Due Date':        { type: 'date_field',     fieldName: 'Due Date',       valueColumn: 'date_value' },
  'Urgent':          { type: 'boolean_field',  fieldName: 'Urgent',         valueColumn: 'boolean_value' },
  'Contract Value':  { type: 'currency_field', fieldName: 'Contract Value', valueColumn: 'currency_value' },
  'Assigned To':     { type: 'user_field',     fieldName: 'Assigned To',    valueColumn: 'user_value' },
  'Priority':        { type: 'select_field',   fieldName: 'Priority',       valueColumn: 'select_reference_value_uuid' },
  'Status':          { type: 'status_field',   fieldName: 'Status',         valueColumn: 'status_reference_value_uuid' },

  // Computed fields (from Task 1)
  'resolutionTime':  { type: 'computed_cycle_time' },
  'sla':             { type: 'computed_sla' },
};

export function getSortFieldConfig(sortBy: string): SortFieldConfig | null {
  return SORT_FIELD_MAP[sortBy] || null;
}

export function isValidSortField(sortBy: string): boolean {
  return sortBy in SORT_FIELD_MAP;
}
```

---

### New File: `backend/src/ticketing/matter/utils/sort_query_builder.ts`

Generate dynamic SQL JOIN and ORDER BY clauses based on field type:

```typescript
export interface SortQueryParts {
  joinClause: string;
  orderByClause: string;
}

export function buildSortQuery(
  config: SortFieldConfig,
  sortOrder: 'asc' | 'desc',
  fieldId?: string,
): SortQueryParts {
  const direction = sortOrder.toUpperCase();
  const nullsPosition = 'NULLS LAST';

  switch (config.type) {
    case 'ticket_column':
      return {
        joinClause: '',
        orderByClause: `tt.${config.directColumn} ${direction}`,
      };

    case 'text_field':
    case 'number_field':
    case 'date_field':
    case 'boolean_field':
      return {
        joinClause: `LEFT JOIN ticketing_ticket_field_value ttfv_sort
          ON tt.id = ttfv_sort.ticket_id
          AND ttfv_sort.ticket_field_id = '${fieldId}'`,
        orderByClause: `ttfv_sort.${config.valueColumn} ${direction} ${nullsPosition}`,
      };

    case 'currency_field':
      return {
        joinClause: `LEFT JOIN ticketing_ticket_field_value ttfv_sort
          ON tt.id = ttfv_sort.ticket_id
          AND ttfv_sort.ticket_field_id = '${fieldId}'`,
        orderByClause: `(ttfv_sort.currency_value->>'amount')::numeric ${direction} ${nullsPosition}`,
      };

    case 'user_field':
      return {
        joinClause: `LEFT JOIN ticketing_ticket_field_value ttfv_sort
          ON tt.id = ttfv_sort.ticket_id
          AND ttfv_sort.ticket_field_id = '${fieldId}'
          LEFT JOIN users u_sort ON ttfv_sort.user_value = u_sort.id`,
        orderByClause: `CONCAT(u_sort.first_name, ' ', u_sort.last_name) ${direction} ${nullsPosition}`,
      };

    case 'select_field':
      return {
        joinClause: `LEFT JOIN ticketing_ticket_field_value ttfv_sort
          ON tt.id = ttfv_sort.ticket_id
          AND ttfv_sort.ticket_field_id = '${fieldId}'
          LEFT JOIN ticketing_field_options tfo_sort
          ON ttfv_sort.select_reference_value_uuid = tfo_sort.id`,
        orderByClause: `tfo_sort.sequence ${direction} ${nullsPosition}`,
      };

    case 'status_field':
      return {
        joinClause: `LEFT JOIN ticketing_ticket_field_value ttfv_sort
          ON tt.id = ttfv_sort.ticket_id
          AND ttfv_sort.ticket_field_id = '${fieldId}'
          LEFT JOIN ticketing_field_status_options tfso_sort
          ON ttfv_sort.status_reference_value_uuid = tfso_sort.id
          LEFT JOIN ticketing_field_status_groups tfsg_sort
          ON tfso_sort.group_id = tfsg_sort.id`,
        orderByClause: `tfsg_sort.sequence ${direction} ${nullsPosition}, tfso_sort.sequence ${direction} ${nullsPosition}`,
      };

    case 'computed_cycle_time':
      return {
        joinClause: `LEFT JOIN LATERAL (
          SELECT
            MIN(tcth.transitioned_at) as started_at,
            MIN(tcth.transitioned_at) FILTER (WHERE tfsg.name = 'Done') as completed_at
          FROM ticketing_cycle_time_histories tcth
          JOIN ticketing_field_status_options tfso ON tcth.to_status_id = tfso.id
          JOIN ticketing_field_status_groups tfsg ON tfso.group_id = tfsg.id
          WHERE tcth.ticket_id = tt.id
        ) cycle_sort ON true`,
        orderByClause: `CASE
          WHEN cycle_sort.completed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (cycle_sort.completed_at - cycle_sort.started_at))
          WHEN cycle_sort.started_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (NOW() - cycle_sort.started_at))
          ELSE NULL
        END ${direction} ${nullsPosition}`,
      };

    case 'computed_sla':
      // SLA categorical order: In Progress (1) -> Met (2) -> Breached (3)
      const slaThresholdSeconds = 8 * 60 * 60; // 8 hours
      return {
        joinClause: `LEFT JOIN LATERAL (
          SELECT
            MIN(tcth.transitioned_at) as started_at,
            MIN(tcth.transitioned_at) FILTER (WHERE tfsg.name = 'Done') as completed_at
          FROM ticketing_cycle_time_histories tcth
          JOIN ticketing_field_status_options tfso ON tcth.to_status_id = tfso.id
          JOIN ticketing_field_status_groups tfsg ON tfso.group_id = tfsg.id
          WHERE tcth.ticket_id = tt.id
        ) sla_sort ON true`,
        orderByClause: `CASE
          WHEN sla_sort.completed_at IS NULL THEN 1
          WHEN EXTRACT(EPOCH FROM (sla_sort.completed_at - sla_sort.started_at)) <= ${slaThresholdSeconds} THEN 2
          ELSE 3
        END ${direction}`,
      };

    default:
      return { joinClause: '', orderByClause: 'tt.created_at DESC' };
  }
}
```

**Why this approach?**
- Each field type needs different JOIN logic (EAV values, user names, option sequences, status groups)
- The `switch` generates SQL fragments that get injected into the main query
- `NULLS LAST` ensures matters without a field value sort to the bottom
- Select/Priority sorts by `sequence` (defined order) rather than label alphabetically
- Status sorts by group sequence first (To Do < In Progress < Done), then status sequence within group

---

### New File: `backend/src/ticketing/matter/utils/field_id_resolver.ts`

Resolve field names to UUIDs with caching:

```typescript
import pool from '../../../db/pool.js';

let fieldIdCache: Map<string, string> | null = null;

export async function getFieldIdByName(fieldName: string): Promise<string | null> {
  if (!fieldIdCache) {
    await loadFieldIdCache();
  }
  return fieldIdCache?.get(fieldName) || null;
}

async function loadFieldIdCache(): Promise<void> {
  const result = await pool.query(
    'SELECT id, name FROM ticketing_fields WHERE deleted_at IS NULL'
  );
  fieldIdCache = new Map();
  for (const row of result.rows) {
    fieldIdCache.set(row.name, row.id);
  }
}

export function clearFieldIdCache(): void {
  fieldIdCache = null;
}
```

**Why cache?** Field definitions rarely change. Caching avoids an extra query on every sort request.

---

### Modified: `backend/src/ticketing/matter/repo/matter_repo.ts` (lines 42-48)

Replace the hardcoded sort logic:

```typescript
// BEFORE (lines 42-48):
let orderByClause = 'tt.created_at DESC';
if (sortBy === 'created_at') {
  orderByClause = `tt.created_at ${sortOrder.toUpperCase()}`;
} else if (sortBy === 'updated_at') {
  orderByClause = `tt.updated_at ${sortOrder.toUpperCase()}`;
}

// AFTER:
import { getSortFieldConfig } from '../utils/sort_field_mapper.js';
import { buildSortQuery } from '../utils/sort_query_builder.js';
import { getFieldIdByName } from '../utils/field_id_resolver.js';

let sortJoinClause = '';
let orderByClause = 'tt.created_at DESC';

const sortConfig = getSortFieldConfig(sortBy);
if (sortConfig) {
  let fieldId: string | undefined;
  if (sortConfig.fieldName) {
    fieldId = (await getFieldIdByName(sortConfig.fieldName)) ?? undefined;
  }
  const sortQuery = buildSortQuery(sortConfig, sortOrder, fieldId);
  sortJoinClause = sortQuery.joinClause;
  orderByClause = sortQuery.orderByClause;
}
```

Then inject `sortJoinClause` into the query (line 62-68):

```sql
-- BEFORE:
SELECT DISTINCT tt.id, tt.board_id, tt.created_at, tt.updated_at
FROM ticketing_ticket tt
LEFT JOIN ticketing_ticket_field_value ttfv ON tt.id = ttfv.ticket_id
WHERE 1=1 ${searchCondition}
ORDER BY ${orderByClause}

-- AFTER:
SELECT tt.id, tt.board_id, tt.created_at, tt.updated_at
FROM ticketing_ticket tt
${sortJoinClause}
WHERE 1=1 ${searchCondition}
ORDER BY ${orderByClause}
```

**Important: `DISTINCT` must be removed.** Two reasons:

1. **Correctness:** PostgreSQL rejects `SELECT DISTINCT ... ORDER BY <expr>` when the ORDER BY expression (e.g., `ttfv_sort.number_value`) is not in the SELECT list. Field-based sorts would fail with a SQL error.
2. **No longer needed:** The original `DISTINCT` existed because of the broad `LEFT JOIN ticketing_ticket_field_value ttfv ON tt.id = ttfv.ticket_id` which multiplied rows (one ticket has many field value rows). Our targeted sort JOIN filters on a single `ticket_field_id`, and the `UNIQUE(ticket_id, ticket_field_id)` constraint guarantees at most one row per ticket -- no duplicates possible.

The original broad LEFT JOIN should also be removed from the base query since it's only needed for search (not yet implemented) and causes the row multiplication that required `DISTINCT` in the first place.

The **count query** (lines 51-56) needs the same cleanup -- remove the broad LEFT JOIN and `DISTINCT`:

```sql
-- BEFORE:
SELECT COUNT(DISTINCT tt.id) as total
FROM ticketing_ticket tt
LEFT JOIN ticketing_ticket_field_value ttfv ON tt.id = ttfv.ticket_id
WHERE 1=1 ${searchCondition}

-- AFTER:
SELECT COUNT(*) as total
FROM ticketing_ticket tt
WHERE 1=1 ${searchCondition}
```

The count query doesn't need any sort join -- it just counts total tickets for pagination.

---

### Modified: `backend/src/ticketing/matter/handlers/getMatters.ts` (line 9)

Add validation whitelist for `sortBy`:

```typescript
const VALID_SORT_FIELDS = [
  'created_at', 'updated_at', 'subject',
  'Case Number', 'Status', 'Assigned To', 'Priority',
  'Contract Value', 'Due Date', 'Urgent',
  'resolutionTime', 'sla',
];

const querySchema = z.object({
  page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 25)),
  sortBy: z.string().optional().default('created_at')
    .refine((val) => VALID_SORT_FIELDS.includes(val), {
      message: `sortBy must be one of: ${VALID_SORT_FIELDS.join(', ')}`,
    }),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional().default(''),
});
```

---

## Frontend Implementation

### Modified: `frontend/src/components/MatterTable.tsx` (lines 101-138)

Add sort click handlers and sort icons to all column headers.

#### 1. Define Sortable Columns Array

```typescript
const SORTABLE_COLUMNS = [
  { key: 'subject',        label: 'Subject' },
  { key: 'Case Number',    label: 'Case Number' },
  { key: 'Status',         label: 'Status' },
  { key: 'Assigned To',    label: 'Assigned To' },
  { key: 'Priority',       label: 'Priority' },
  { key: 'Contract Value', label: 'Contract Value' },
  { key: 'Due Date',       label: 'Due Date' },
  { key: 'Urgent',         label: 'Urgent' },
  { key: 'resolutionTime', label: 'Resolution Time' },
  { key: 'sla',            label: 'SLA' },
] as const;
```

#### 2. Replace All `<th>` Elements

Replace the current header rows (where only Subject has `onClick`) with sortable headers for every column:

```tsx
<thead className="bg-gray-50">
  <tr>
    {SORTABLE_COLUMNS.map(({ key, label }) => (
      <th
        key={key}
        onClick={() => onSort(key)}
        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
      >
        <div className="flex items-center gap-1">
          {label}
          {renderSortIcon(key)}
        </div>
      </th>
    ))}
  </tr>
</thead>
```

This replaces the current 10 individual `<th>` elements (lines 102-138) with a single map. The existing `renderSortIcon()` function already handles active/inactive sort icons and requires no changes.

#### 3. Frontend Sort State (No Changes Needed)

The `App.tsx` sort state management already handles arbitrary sort keys:

```typescript
// App.tsx - already works for all columns
const handleSort = (column: string) => {
  if (sortBy === column) {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  } else {
    setSortBy(column);
    setSortOrder('asc');
  }
};
```

The `useMatters` hook passes `sortBy` directly as a query parameter -- no changes needed.

---

## Files to Modify

| File | Action | Changes |
|------|--------|---------|
| `backend/src/ticketing/matter/utils/sort_field_mapper.ts` | **Create** | Sort field config map and lookup functions |
| `backend/src/ticketing/matter/utils/sort_query_builder.ts` | **Create** | Dynamic SQL builder for all field types |
| `backend/src/ticketing/matter/utils/field_id_resolver.ts` | **Create** | Field name to UUID resolver with cache |
| `backend/src/ticketing/matter/repo/matter_repo.ts` | **Modify** | Replace hardcoded sort (lines 42-48), inject JOIN (lines 62-68), remove `DISTINCT` |
| `backend/src/ticketing/matter/handlers/getMatters.ts` | **Modify** | Add sortBy whitelist validation (line 9) |
| `frontend/src/components/MatterTable.tsx` | **Modify** | Add sort handlers to all column headers (lines 101-138) |
| `database/schema.sql` | **Modify** | Add composite indexes for sort performance |

---

## Key Design Decisions

### Sorting by Field Sequence vs. Label
- **Priority** (select field): Sorted by `sequence` column in `ticketing_field_options`, not alphabetically. This preserves the intended priority order (e.g., Critical > High > Medium > Low).
- **Status** (status field): Sorted by group sequence first (`ticketing_field_status_groups.sequence`), then status sequence within the group. This keeps statuses ordered logically (To Do -> In Progress -> Done).

### EAV Join Strategy
Each sort uses a single conditional LEFT JOIN aliased as `ttfv_sort`. The join includes both `ticket_id` and `ticket_field_id` conditions, so only the relevant field's value is used for sorting. The `UNIQUE(ticket_id, ticket_field_id)` constraint guarantees a 1:1 relationship, so no `DISTINCT` is needed and pagination counts remain accurate.

**Why targeted JOINs over GROUP BY + FILTER:** An alternative approach uses a broad JOIN to all field values with `GROUP BY` and `FILTER(WHERE ticket_field_id = ...)` in the ORDER BY. While elegant for simple types, it scans all field value rows for all tickets and requires unconditional joins to reference tables (users, options, status groups) even when they're irrelevant to the current sort. The targeted JOIN approach only adds the joins needed for the specific sort field, processing fewer rows.

### NULL Handling
All field-based sorts use `NULLS LAST` so matters without a particular field value always appear at the bottom, regardless of sort direction.

### SQL Injection Prevention
Field IDs come from the database cache (UUIDs), not from user input. The `sortBy` parameter is validated against a whitelist in the Zod schema. The `sortOrder` is constrained to `'asc' | 'desc'` by Zod.

### Composite Indexes for Sort Performance
The existing single-column indexes on `number_value` and `date_value` are suboptimal for sorted EAV queries because the query filters on `ticket_field_id` first. Add composite indexes so PostgreSQL can seek directly to a field's values in sorted order:

```sql
CREATE INDEX idx_ttfv_sort_number ON ticketing_ticket_field_value(ticket_field_id, number_value);
CREATE INDEX idx_ttfv_sort_date ON ticketing_ticket_field_value(ticket_field_id, date_value);
CREATE INDEX idx_ttfv_sort_string ON ticketing_ticket_field_value(ticket_field_id, string_value);
CREATE INDEX idx_ttfv_sort_boolean ON ticketing_ticket_field_value(ticket_field_id, boolean_value);
```

These enable index-only scans for the most common sort operations.

### Pagination at Scale
The current `LIMIT/OFFSET` pagination works correctly with the targeted JOIN approach since the 1:1 join preserves exact row counts. However, `OFFSET` performance degrades at high page numbers (e.g., `OFFSET 10000` still scans and discards 10,000 rows). For 100K+ matters, **keyset/cursor pagination** would be the next optimization -- out of scope for this task but worth noting.

---

## Verification Plan

1. **Start the application**:
   ```bash
   docker compose up
   ```

2. **Test backend sorting via API** (curl examples):
   ```bash
   # Sort by Case Number ascending
   curl "http://localhost:3000/api/v1/matters?sortBy=Case%20Number&sortOrder=asc"

   # Sort by Priority descending
   curl "http://localhost:3000/api/v1/matters?sortBy=Priority&sortOrder=desc"

   # Sort by Status ascending
   curl "http://localhost:3000/api/v1/matters?sortBy=Status&sortOrder=asc"

   # Sort by Contract Value descending
   curl "http://localhost:3000/api/v1/matters?sortBy=Contract%20Value&sortOrder=desc"

   # Sort by Resolution Time ascending
   curl "http://localhost:3000/api/v1/matters?sortBy=resolutionTime&sortOrder=asc"

   # Invalid sort field returns 400
   curl "http://localhost:3000/api/v1/matters?sortBy=invalid_field"
   ```

3. **Test frontend sorting**:
   - Open http://localhost:8080
   - Click each column header and verify:
     - Sort icon changes to active (blue arrow)
     - Data reorders correctly
     - Clicking same column toggles asc/desc
     - Clicking different column switches sort target

4. **Verify edge cases**:
   - NULL values appear at the bottom for all sort directions
   - Pagination works correctly with sorting (page 2 continues the sort order)
   - Matters with no Priority, no Assigned To, etc. sort to the end

---

## Unit Testing Strategy

### Test File: `backend/src/ticketing/matter/__tests__/sort_query_builder.test.ts`

#### 1. Query Builder Tests (Pure Unit Tests)

```typescript
describe('buildSortQuery', () => {
  it('returns direct column sort for ticket_column type', () => {
    const config = { type: 'ticket_column', directColumn: 'created_at' };
    const result = buildSortQuery(config, 'asc');
    expect(result.joinClause).toBe('');
    expect(result.orderByClause).toBe('tt.created_at ASC');
  });

  it('joins field value table for number_field type', () => {
    const config = { type: 'number_field', fieldName: 'Case Number', valueColumn: 'number_value' };
    const result = buildSortQuery(config, 'desc', 'uuid-123');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-123'");
    expect(result.orderByClause).toContain('number_value DESC NULLS LAST');
  });

  it('extracts JSONB amount for currency_field type', () => {
    const config = { type: 'currency_field', fieldName: 'Contract Value', valueColumn: 'currency_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-456');
    expect(result.orderByClause).toContain("currency_value->>'amount'");
  });

  it('joins users table for user_field type', () => {
    const config = { type: 'user_field', fieldName: 'Assigned To', valueColumn: 'user_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-789');
    expect(result.joinClause).toContain('users u_sort');
    expect(result.orderByClause).toContain('first_name');
  });

  it('sorts by group then status sequence for status_field', () => {
    const config = { type: 'status_field', fieldName: 'Status', valueColumn: 'status_reference_value_uuid' };
    const result = buildSortQuery(config, 'asc', 'uuid-status');
    expect(result.joinClause).toContain('ticketing_field_status_groups');
    expect(result.orderByClause).toContain('tfsg_sort.sequence');
    expect(result.orderByClause).toContain('tfso_sort.sequence');
  });

  it('uses LATERAL subquery for computed_cycle_time', () => {
    const config = { type: 'computed_cycle_time' };
    const result = buildSortQuery(config, 'desc');
    expect(result.joinClause).toContain('LATERAL');
    expect(result.joinClause).toContain('ticketing_cycle_time_histories');
  });
});
```

#### 2. Sort Field Mapper Tests

```typescript
describe('sort_field_mapper', () => {
  it('returns config for valid sort field', () => {
    expect(getSortFieldConfig('Case Number')).toEqual({
      type: 'number_field',
      fieldName: 'Case Number',
      valueColumn: 'number_value',
    });
  });

  it('returns null for unknown sort field', () => {
    expect(getSortFieldConfig('nonexistent')).toBeNull();
  });

  it('validates all expected sort fields', () => {
    expect(isValidSortField('subject')).toBe(true);
    expect(isValidSortField('Status')).toBe(true);
    expect(isValidSortField('invalid')).toBe(false);
  });
});
```

#### 3. Field ID Resolver Tests (With Mocked DB)

```typescript
describe('field_id_resolver', () => {
  beforeEach(() => clearFieldIdCache());

  it('loads field IDs from database on first call', async () => {
    vi.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'Case Number' },
        { id: 'uuid-2', name: 'subject' },
      ],
    });

    const id = await getFieldIdByName('Case Number');
    expect(id).toBe('uuid-1');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('uses cache on subsequent calls', async () => {
    vi.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ id: 'uuid-1', name: 'subject' }],
    });

    await getFieldIdByName('subject');
    await getFieldIdByName('subject');
    expect(pool.query).toHaveBeenCalledTimes(1); // Only one DB call
  });
});
```

---

## Implementation Order

1. **Create `sort_field_mapper.ts`** -- field config map (no dependencies)
2. **Create `sort_query_builder.ts`** -- SQL generation (depends on SortFieldConfig type)
3. **Create `field_id_resolver.ts`** -- field UUID lookup (depends on DB pool)
4. **Modify `matter_repo.ts`** -- wire up sort utilities (depends on 1-3)
5. **Modify `getMatters.ts`** -- add Zod whitelist validation
6. **Modify `MatterTable.tsx`** -- add click handlers to all columns
7. **Write unit tests** -- test sort_query_builder and field_id_resolver
8. **Integration test** -- verify sorting end-to-end via API and UI
