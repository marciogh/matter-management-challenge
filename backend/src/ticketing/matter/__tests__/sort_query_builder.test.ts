import { describe, it, expect } from 'vitest';
import { buildSortQuery } from '../utils/sort_query_builder.js';
import { SortFieldConfig } from '../utils/sort_field_mapper.js';

describe('buildSortQuery', () => {
  it('returns direct column sort for ticket_column type', () => {
    const config: SortFieldConfig = { type: 'ticket_column', directColumn: 'created_at' };
    const result = buildSortQuery(config, 'asc');
    expect(result.joinClause).toBe('');
    expect(result.orderByClause).toBe('tt.created_at ASC');
  });

  it('returns descending for ticket_column type', () => {
    const config: SortFieldConfig = { type: 'ticket_column', directColumn: 'updated_at' };
    const result = buildSortQuery(config, 'desc');
    expect(result.orderByClause).toBe('tt.updated_at DESC');
  });

  it('joins field value table for text_field type', () => {
    const config: SortFieldConfig = { type: 'text_field', fieldName: 'subject', valueColumn: 'text_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-text');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-text'");
    expect(result.orderByClause).toContain('text_value ASC NULLS LAST');
  });

  it('joins field value table for number_field type', () => {
    const config: SortFieldConfig = { type: 'number_field', fieldName: 'Case Number', valueColumn: 'number_value' };
    const result = buildSortQuery(config, 'desc', 'uuid-123');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-123'");
    expect(result.orderByClause).toContain('number_value DESC NULLS LAST');
  });

  it('joins field value table for date_field type', () => {
    const config: SortFieldConfig = { type: 'date_field', fieldName: 'Due Date', valueColumn: 'date_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-date');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-date'");
    expect(result.orderByClause).toContain('date_value ASC NULLS LAST');
  });

  it('joins field value table for boolean_field type', () => {
    const config: SortFieldConfig = { type: 'boolean_field', fieldName: 'Urgent', valueColumn: 'boolean_value' };
    const result = buildSortQuery(config, 'desc', 'uuid-bool');
    expect(result.orderByClause).toContain('boolean_value DESC NULLS LAST');
  });

  it('extracts JSONB amount for currency_field type', () => {
    const config: SortFieldConfig = { type: 'currency_field', fieldName: 'Contract Value', valueColumn: 'currency_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-456');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-456'");
    expect(result.orderByClause).toContain("currency_value->>'amount'");
    expect(result.orderByClause).toContain('::numeric');
    expect(result.orderByClause).toContain('ASC NULLS LAST');
  });

  it('joins users table for user_field type', () => {
    const config: SortFieldConfig = { type: 'user_field', fieldName: 'Assigned To', valueColumn: 'user_value' };
    const result = buildSortQuery(config, 'asc', 'uuid-789');
    expect(result.joinClause).toContain('users u_sort');
    expect(result.joinClause).toContain("ttfv_sort.ticket_field_id = 'uuid-789'");
    expect(result.orderByClause).toContain('first_name');
    expect(result.orderByClause).toContain('last_name');
    expect(result.orderByClause).toContain('ASC NULLS LAST');
  });

  it('joins field options for select_field type and sorts by sequence', () => {
    const config: SortFieldConfig = { type: 'select_field', fieldName: 'Priority', valueColumn: 'select_reference_value_uuid' };
    const result = buildSortQuery(config, 'desc', 'uuid-select');
    expect(result.joinClause).toContain('ticketing_field_options tfo_sort');
    expect(result.orderByClause).toContain('tfo_sort.sequence DESC NULLS LAST');
  });

  it('sorts by group then status sequence for status_field', () => {
    const config: SortFieldConfig = { type: 'status_field', fieldName: 'Status', valueColumn: 'status_reference_value_uuid' };
    const result = buildSortQuery(config, 'asc', 'uuid-status');
    expect(result.joinClause).toContain('ticketing_field_status_options tfso_sort');
    expect(result.joinClause).toContain('ticketing_field_status_groups tfsg_sort');
    expect(result.orderByClause).toContain('tfsg_sort.sequence');
    expect(result.orderByClause).toContain('tfso_sort.sequence');
  });

  it('uses LATERAL subquery for computed_cycle_time', () => {
    const config: SortFieldConfig = { type: 'computed_cycle_time' };
    const result = buildSortQuery(config, 'desc');
    expect(result.joinClause).toContain('LATERAL');
    expect(result.joinClause).toContain('ticketing_cycle_time_histories');
    expect(result.orderByClause).toContain('EXTRACT(EPOCH FROM');
    expect(result.orderByClause).toContain('DESC NULLS LAST');
  });

  it('uses LATERAL subquery for computed_sla with categorical ordering', () => {
    const config: SortFieldConfig = { type: 'computed_sla' };
    const result = buildSortQuery(config, 'asc');
    expect(result.joinClause).toContain('LATERAL');
    expect(result.joinClause).toContain('ticketing_cycle_time_histories');
    expect(result.orderByClause).toContain('CASE');
    expect(result.orderByClause).toContain('completed_at IS NULL THEN 1'); // In Progress
    expect(result.orderByClause).toContain('THEN 2'); // Met
    expect(result.orderByClause).toContain('ELSE 3'); // Breached
  });

  it('returns default sort for unknown type', () => {
    const config = { type: 'unknown_type' } as unknown as SortFieldConfig;
    const result = buildSortQuery(config, 'asc');
    expect(result.joinClause).toBe('');
    expect(result.orderByClause).toBe('tt.created_at DESC');
  });
});
