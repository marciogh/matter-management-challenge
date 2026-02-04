# Task: Store Computed SLA Data in EAV Model

## Problem

Currently, cycle time and SLA status are computed in real-time for every request:
- `MatterService.getMatters()` calls `calculateCycleTimeAndSLA()` for each matter
- Each call executes a database query to `ticketing_cycle_time_histories`
- For a list of 25 matters, this results in 25+ separate queries
- These metrics need to be **displayed in the UI** and **sortable** alongside other fields

Reference: [cycle_time_service.ts:78-144](backend/src/ticketing/matter/service/cycle_time_service.ts#L78-L144)

## Solution Approach

Store computed cycle time and SLA data as **system fields** in the existing EAV model:
- Create new field definitions in `ticketing_fields` for computed metrics
- Store precomputed values in `ticketing_ticket_field_values` alongside other field data
- Update values via application logic when status changes
- Leverage existing field infrastructure for display and sorting

### Why EAV Instead of Direct Columns?

1. **Sorting requirement**: Existing sort infrastructure works with EAV fields
2. **UI integration**: Field rendering expects data in the fields structure
3. **Architectural consistency**: All displayable/sortable data follows same pattern
4. **Flexibility**: Easy to add more computed metrics in the future

## Implementation Steps

### 1. Create System Field Definitions

Insert field definitions for the computed metrics:

```sql
-- Migration: Create computed metric fields
INSERT INTO ticketing_fields (name, field_type, is_system_field)
VALUES
  ('Started At', 'datetime', true),
  ('Completed At', 'datetime', true),
  ('Resolution Time', 'number', true),
  ('SLA Status', 'text', true);
```

Field purposes:
- **Started At**: Timestamp when matter first entered "In Progress" or "Done" status group
- **Completed At**: Timestamp when matter entered "Done" status group (null if not done)
- **Resolution Time**: Milliseconds between Started At and Completed At (or current time if in progress)
- **SLA Status**: One of: 'Met', 'Breached', 'In Progress'

### 2. Update Application Logic

#### 2.1 Add Method to Update Computed Fields

In `CycleTimeService`:

```typescript
// cycle_time_service.ts

import { getFieldIdByName } from '../utils/field_id_resolver.js';
import pool from '../../../db/pool.js';

async updateComputedFields(
  ticketId: string,
  statusGroupName: string | null,
): Promise<void> {
  const { cycleTime, sla } = await this.calculateCycleTimeAndSLA(
    ticketId,
    statusGroupName,
  );

  // Get field IDs for computed fields
  const fieldIds = await this._getComputedFieldIds();

  // Prepare values to store
  const fieldUpdates = [
    {
      fieldId: fieldIds.startedAt,
      fieldType: 'datetime',
      value: cycleTime.startedAt,
    },
    {
      fieldId: fieldIds.completedAt,
      fieldType: 'datetime',
      value: cycleTime.completedAt,
    },
    {
      fieldId: fieldIds.resolutionTime,
      fieldType: 'number',
      value: cycleTime.resolutionTimeMs,
    },
    {
      fieldId: fieldIds.slaStatus,
      fieldType: 'text',
      value: sla,
    },
  ];

  // Update all computed field values
  await this._updateFieldValues(ticketId, fieldUpdates);
}

/**
 * Get field IDs for computed metrics fields.
 * Uses existing field_id_resolver utility for caching.
 */
private async _getComputedFieldIds(): Promise<{
  startedAt: string;
  completedAt: string;
  resolutionTime: string;
  slaStatus: string;
}> {
  const [startedAt, completedAt, resolutionTime, slaStatus] = await Promise.all([
    getFieldIdByName('Started At'),
    getFieldIdByName('Completed At'),
    getFieldIdByName('Resolution Time'),
    getFieldIdByName('SLA Status'),
  ]);

  if (!startedAt || !completedAt || !resolutionTime || !slaStatus) {
    throw new Error('Computed metric fields not found in database');
  }

  return { startedAt, completedAt, resolutionTime, slaStatus };
}

/**
 * Bulk update field values for computed metrics.
 * Uses UPSERT pattern similar to MatterRepo.updateMatterField but handles multiple fields.
 */
private async _updateFieldValues(
  ticketId: string,
  fieldUpdates: Array<{
    fieldId: string;
    fieldType: 'datetime' | 'number' | 'text';
    value: Date | number | string | null;
  }>,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const { fieldId, fieldType, value } of fieldUpdates) {
      // Determine which column to update based on field type
      let columnName: string;
      let columnValue: string | number | Date | null = null;

      switch (fieldType) {
        case 'datetime':
          columnName = 'date_value';
          columnValue = value as Date | null;
          break;
        case 'number':
          columnName = 'number_value';
          columnValue = value as number | null;
          break;
        case 'text':
          columnName = 'text_value';
          columnValue = value as string | null;
          break;
        default:
          throw new Error(`Unsupported field type for computed metrics: ${fieldType}`);
      }

      // Upsert field value
      // Note: Using system user ID (1) for created_by/updated_by since these are system-computed
      await client.query(
        `INSERT INTO ticketing_ticket_field_value
         (ticket_id, ticket_field_id, ${columnName}, created_by, updated_by)
         VALUES ($1, $2, $3, 1, 1)
         ON CONFLICT (ticket_id, ticket_field_id)
         DO UPDATE SET ${columnName} = $3, updated_by = 1, updated_at = NOW()`,
        [ticketId, fieldId, columnValue],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**Key Implementation Details:**

- **`_getComputedFieldIds()`**:
  - Reuses existing `field_id_resolver` utility for caching
  - Fetches all field IDs in parallel with `Promise.all`
  - Throws error if fields don't exist (fail fast)

- **`_updateFieldValues()`**:
  - Handles bulk updates within a transaction
  - Maps field types to appropriate database columns (`date_value`, `number_value`, `text_value`)
  - Uses UPSERT pattern (INSERT ... ON CONFLICT DO UPDATE)
  - Uses system user ID (1) for audit fields since these are system-computed
  - Properly handles NULL values for incomplete cycle times

#### 2.2 Call Update When Status Changes

In `MatterService.updateMatter()`:

```typescript
// matter_service.ts

import { getFieldIdByName } from '../utils/field_id_resolver.js';

async updateMatter(
  matterId: string,
  fieldId: string,
  fieldType: string,
  value: string | number | boolean | Date | CurrencyValue | UserValue | StatusValue | null,
  userId: number,
): Promise<void> {
  await this.matterRepo.updateMatterField(matterId, fieldId, fieldType, value, userId);

  // If status field changed, update computed metrics
  const statusFieldId = await getFieldIdByName('Status');

  if (fieldId === statusFieldId) {
    const statusGroupName = (value as StatusValue)?.groupName || null;
    await this.cycleTimeService.updateComputedFields(matterId, statusGroupName);
  }
}
```

**Implementation Notes:**

- Check if updated field is the Status field using field_id_resolver
- Extract `groupName` from StatusValue (needed for SLA determination)
- Call `updateComputedFields()` asynchronously after main update completes
- No need to wrap in try/catch - let errors bubble up to caller

### 3. Handle Existing Data

Create a migration script to populate computed fields for existing matters:

```typescript
// scripts/backfill-computed-metrics.ts

import pool from '../src/db/pool.js';
import { CycleTimeService } from '../src/ticketing/matter/service/cycle_time_service.js';
import { getFieldIdByName } from '../src/ticketing/matter/utils/field_id_resolver.js';

async function backfillComputedMetrics() {
  const cycleTimeService = new CycleTimeService();
  const statusFieldId = await getFieldIdByName('Status');

  if (!statusFieldId) {
    throw new Error('Status field not found');
  }

  // Get all matters with their current status group names
  const result = await pool.query(`
    SELECT
      t.id as ticket_id,
      tfsg.name as status_group_name
    FROM ticketing_tickets t
    LEFT JOIN ticketing_ticket_field_value ttfv
      ON t.id = ttfv.ticket_id
      AND ttfv.ticket_field_id = $1
    LEFT JOIN ticketing_field_status_options tfso
      ON ttfv.status_reference_value_uuid = tfso.id
    LEFT JOIN ticketing_field_status_groups tfsg
      ON tfso.group_id = tfsg.id
    WHERE t.deleted_at IS NULL
  `, [statusFieldId]);

  console.log(`Backfilling computed metrics for ${result.rows.length} matters...`);

  let processed = 0;
  for (const row of result.rows) {
    await cycleTimeService.updateComputedFields(
      row.ticket_id,
      row.status_group_name,
    );
    processed++;

    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${result.rows.length}...`);
    }
  }

  console.log(`Backfill complete! Processed ${processed} matters.`);
}

backfillComputedMetrics()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
```

Run with:
```bash
npx tsx scripts/backfill-computed-metrics.ts
```

### 4. Update Field Retrieval

The existing `MatterRepo.getMatters()` JSONB aggregation will automatically include these new fields since they're stored in `ticketing_ticket_field_values`.

**No changes needed** to query logic - computed fields will appear in `matter.fields` alongside other fields.

Reference: [matter_repo.ts:145-236](backend/src/ticketing/matter/repo/matter_repo.ts#L145-L236) - the JSONB aggregation query already handles all field types.

### 5. Remove Real-time Calculation

Once computed fields are populated, remove the real-time calculation from `MatterService`:

```typescript
// matter_service.ts - BEFORE
async getMatters(params: MatterListParams): Promise<MatterListResponse> {
  const { matters, total } = await this.matterRepo.getMatters(params);

  // Calculate cycle time and SLA for each matter  ← REMOVE THIS
  const enrichedMatters = await Promise.all(
    matters.map(async (matter) => {
      const { cycleTime, sla } = await this.cycleTimeService.calculateCycleTimeAndSLA(...);
      return { ...matter, cycleTime, sla };
    })
  );
  // ...
}
```

```typescript
// matter_service.ts - AFTER
async getMatters(params: MatterListParams): Promise<MatterListResponse> {
  const { matters, total } = await this.matterRepo.getMatters(params);

  // Computed fields are already in matter.fields, no enrichment needed
  return {
    data: matters,
    total,
    page: params.page || 1,
    limit: params.limit || 25,
    totalPages: Math.ceil(total / (params.limit || 25)),
  };
}
```

### 6. UI Considerations

Since computed fields are system-managed:

- **Read-only display**: Check `is_system_field = true` to prevent editing
- **Field rendering**: Use existing field rendering components
- **Sorting**: Works automatically through existing sort infrastructure
- **Special rendering for SLA Status**:
  - 'Met' → Green badge/indicator
  - 'Breached' → Red badge/indicator
  - 'In Progress' → Yellow/gray indicator

Example UI logic:
```typescript
// Frontend
function isFieldEditable(field: Field): boolean {
  return !field.isSystemField;
}

function getSLAStatusColor(status: string): string {
  switch (status) {
    case 'Met': return 'green';
    case 'Breached': return 'red';
    case 'In Progress': return 'gray';
    default: return 'gray';
  }
}
```

## Benefits

✅ **Performance**: Eliminates 25+ queries per list request → 0 cycle time calculation queries
✅ **Sortable**: Works with existing sort infrastructure without special cases
✅ **Consistent Architecture**: All fields follow same EAV pattern
✅ **UI Integration**: Automatic display through existing field rendering
✅ **Maintainable**: Clear application-level update flow
✅ **Extensible**: Easy to add more computed metrics in the future

## Testing Strategy

### 1. Unit Tests

```typescript
// __tests__/cycle_time_service.test.ts

describe('CycleTimeService.updateComputedFields', () => {
  it('should update all computed field values', async () => {
    // Test field value updates for various scenarios
  });

  it('should handle null values for incomplete cycle times', async () => {
    // Test matters without started_at or completed_at
  });

  it('should throw error if computed fields do not exist', async () => {
    // Test error handling for missing field definitions
  });
});
```

### 2. Integration Tests

```typescript
// __tests__/integration/computed_fields.test.ts

describe('Computed Fields Integration', () => {
  it('should update computed fields when status changes', async () => {
    // Create matter, change status, verify computed fields updated
  });

  it('should include computed fields in matter queries', async () => {
    // Fetch matter, verify computed fields in matter.fields
  });

  it('should support sorting by computed fields', async () => {
    // Test sort by SLA Status, Resolution Time, etc.
  });
});
```

### 3. Performance Tests

```typescript
// Benchmark queries before/after
describe('Performance Comparison', () => {
  it('should reduce query count for matter lists', async () => {
    // Measure query count before/after for getMatters()
    // Expected: N queries → 1-2 queries
  });

  it('should improve response time for matter lists', async () => {
    // Measure response time for 25 matter list
    // Expected: significant improvement
  });
});
```

### 4. Data Migration Validation

```bash
# Run backfill script
npx tsx scripts/backfill-computed-metrics.ts

# Validate results
SELECT
  COUNT(*) as total_matters,
  COUNT(started_at.date_value) as with_started_at,
  COUNT(sla_status.text_value) as with_sla_status
FROM ticketing_tickets t
LEFT JOIN ticketing_ticket_field_value started_at
  ON t.id = started_at.ticket_id
  AND started_at.ticket_field_id = (SELECT id FROM ticketing_fields WHERE name = 'Started At')
LEFT JOIN ticketing_ticket_field_value sla_status
  ON t.id = sla_status.ticket_id
  AND sla_status.ticket_field_id = (SELECT id FROM ticketing_fields WHERE name = 'SLA Status');
```

## Future Optimizations

**Note**: Indexing is deliberately excluded from this task. EAV indexing should be evaluated holistically as a separate optimization effort that benefits ALL fields, not just computed ones.

Potential future work:
- **EAV Index Optimization**: Analyze and optimize indexes for `ticketing_ticket_field_values` to improve sorting/filtering across all fields
- **Caching Layer**: Add caching for frequently accessed matters
- **Materialized Views**: Consider materialized views for complex field aggregations
- **Incremental Updates**: Optimize to only recalculate when cycle time actually changes (e.g., skip update if status changes within same group)
- **Background Processing**: Move computation to background jobs for non-critical updates

## Implementation Checklist

- [ ] Create migration to insert computed metric fields into `ticketing_fields`
- [ ] Implement `CycleTimeService.updateComputedFields()` with `_getComputedFieldIds()` and `_updateFieldValues()`
- [ ] Update `MatterService.updateMatter()` to call computed field update on status changes
- [ ] Create `scripts/backfill-computed-metrics.ts` migration script
- [ ] Write unit tests for `updateComputedFields()` method
- [ ] Write integration tests for status change → field update flow
- [ ] Test sorting on computed fields
- [ ] Run backfill script on development/staging data
- [ ] Validate backfill results with SQL queries
- [ ] Remove real-time calculation from `MatterService.getMatters()` and `getMatterById()`
- [ ] Update frontend to mark computed fields as read-only
- [ ] Add special rendering for SLA Status (color indicators)
- [ ] Performance test before/after (measure query count and response time)
- [ ] Update API documentation if computed fields are exposed in API
