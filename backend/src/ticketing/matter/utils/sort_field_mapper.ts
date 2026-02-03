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
