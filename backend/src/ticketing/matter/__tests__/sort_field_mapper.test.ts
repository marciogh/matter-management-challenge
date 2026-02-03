import { describe, it, expect } from 'vitest';
import { getSortFieldConfig, isValidSortField, SORT_FIELD_MAP } from '../utils/sort_field_mapper.js';

describe('sort_field_mapper', () => {
  describe('getSortFieldConfig', () => {
    it('returns config for created_at field', () => {
      expect(getSortFieldConfig('created_at')).toEqual({
        type: 'ticket_column',
        directColumn: 'created_at',
      });
    });

    it('returns config for updated_at field', () => {
      expect(getSortFieldConfig('updated_at')).toEqual({
        type: 'ticket_column',
        directColumn: 'updated_at',
      });
    });

    it('returns config for subject field', () => {
      expect(getSortFieldConfig('subject')).toEqual({
        type: 'text_field',
        fieldName: 'subject',
        valueColumn: 'text_value',
      });
    });

    it('returns config for Case Number field', () => {
      expect(getSortFieldConfig('Case Number')).toEqual({
        type: 'number_field',
        fieldName: 'Case Number',
        valueColumn: 'number_value',
      });
    });

    it('returns config for Due Date field', () => {
      expect(getSortFieldConfig('Due Date')).toEqual({
        type: 'date_field',
        fieldName: 'Due Date',
        valueColumn: 'date_value',
      });
    });

    it('returns config for Urgent field', () => {
      expect(getSortFieldConfig('Urgent')).toEqual({
        type: 'boolean_field',
        fieldName: 'Urgent',
        valueColumn: 'boolean_value',
      });
    });

    it('returns config for Contract Value field', () => {
      expect(getSortFieldConfig('Contract Value')).toEqual({
        type: 'currency_field',
        fieldName: 'Contract Value',
        valueColumn: 'currency_value',
      });
    });

    it('returns config for Assigned To field', () => {
      expect(getSortFieldConfig('Assigned To')).toEqual({
        type: 'user_field',
        fieldName: 'Assigned To',
        valueColumn: 'user_value',
      });
    });

    it('returns config for Priority field', () => {
      expect(getSortFieldConfig('Priority')).toEqual({
        type: 'select_field',
        fieldName: 'Priority',
        valueColumn: 'select_reference_value_uuid',
      });
    });

    it('returns config for Status field', () => {
      expect(getSortFieldConfig('Status')).toEqual({
        type: 'status_field',
        fieldName: 'Status',
        valueColumn: 'status_reference_value_uuid',
      });
    });

    it('returns config for resolutionTime field', () => {
      expect(getSortFieldConfig('resolutionTime')).toEqual({
        type: 'computed_cycle_time',
      });
    });

    it('returns config for sla field', () => {
      expect(getSortFieldConfig('sla')).toEqual({
        type: 'computed_sla',
      });
    });

    it('returns null for unknown field', () => {
      expect(getSortFieldConfig('nonexistent')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getSortFieldConfig('')).toBeNull();
    });
  });

  describe('isValidSortField', () => {
    it('validates created_at', () => {
      expect(isValidSortField('created_at')).toBe(true);
    });

    it('validates updated_at', () => {
      expect(isValidSortField('updated_at')).toBe(true);
    });

    it('validates subject', () => {
      expect(isValidSortField('subject')).toBe(true);
    });

    it('validates Case Number', () => {
      expect(isValidSortField('Case Number')).toBe(true);
    });

    it('validates Status', () => {
      expect(isValidSortField('Status')).toBe(true);
    });

    it('validates Assigned To', () => {
      expect(isValidSortField('Assigned To')).toBe(true);
    });

    it('validates Priority', () => {
      expect(isValidSortField('Priority')).toBe(true);
    });

    it('validates Contract Value', () => {
      expect(isValidSortField('Contract Value')).toBe(true);
    });

    it('validates Due Date', () => {
      expect(isValidSortField('Due Date')).toBe(true);
    });

    it('validates Urgent', () => {
      expect(isValidSortField('Urgent')).toBe(true);
    });

    it('validates resolutionTime', () => {
      expect(isValidSortField('resolutionTime')).toBe(true);
    });

    it('validates sla', () => {
      expect(isValidSortField('sla')).toBe(true);
    });

    it('rejects invalid field', () => {
      expect(isValidSortField('invalid')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidSortField('')).toBe(false);
    });

    it('rejects field with wrong case', () => {
      expect(isValidSortField('SUBJECT')).toBe(false);
    });
  });

  describe('SORT_FIELD_MAP', () => {
    it('contains all expected fields', () => {
      const expectedFields = [
        'created_at', 'updated_at', 'subject',
        'Case Number', 'Due Date', 'Urgent', 'Contract Value',
        'Assigned To', 'Priority', 'Status',
        'resolutionTime', 'sla',
      ];

      expectedFields.forEach(field => {
        expect(SORT_FIELD_MAP[field]).toBeDefined();
      });
    });

    it('has exactly 12 fields', () => {
      expect(Object.keys(SORT_FIELD_MAP)).toHaveLength(12);
    });
  });
});
