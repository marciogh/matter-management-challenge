import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFieldIdByName, clearFieldIdCache } from '../utils/field_id_resolver.js';
import pool from '../../../db/pool.js';
import type { QueryResult } from 'pg';

type FieldRow = { id: string; name: string };

vi.mock('../../../db/pool.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('field_id_resolver', () => {
  beforeEach(() => {
    clearFieldIdCache();
    vi.clearAllMocks();
  });

  it('loads field IDs from database on first call', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'Case Number' },
        { id: 'uuid-2', name: 'subject' },
        { id: 'uuid-3', name: 'Status' },
      ],
    } as Partial<QueryResult<FieldRow>>);

    const id = await getFieldIdByName('Case Number');
    expect(id).toBe('uuid-1');
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, name FROM ticketing_fields WHERE deleted_at IS NULL'
    );
  });

  it('returns correct ID for different fields', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'Case Number' },
        { id: 'uuid-2', name: 'subject' },
        { id: 'uuid-3', name: 'Status' },
      ],
    } as Partial<QueryResult<FieldRow>>);

    await getFieldIdByName('Case Number');
    const subjectId = await getFieldIdByName('subject');
    const statusId = await getFieldIdByName('Status');

    expect(subjectId).toBe('uuid-2');
    expect(statusId).toBe('uuid-3');
  });

  it('uses cache on subsequent calls', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'subject' },
        { id: 'uuid-2', name: 'Status' },
      ],
    } as Partial<QueryResult<FieldRow>>);

    await getFieldIdByName('subject');
    await getFieldIdByName('subject');
    await getFieldIdByName('Status');

    expect(pool.query).toHaveBeenCalledTimes(1); // Only one DB call
  });

  it('returns null for non-existent field', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'subject' },
      ],
    } as Partial<QueryResult<FieldRow>>);

    const id = await getFieldIdByName('nonexistent');
    expect(id).toBeNull();
  });

  it('reloads cache after clearFieldIdCache is called', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{ id: 'uuid-1', name: 'subject' }],
      } as Partial<QueryResult<FieldRow>>)
      .mockResolvedValueOnce({
        rows: [{ id: 'uuid-2', name: 'subject' }],
      } as Partial<QueryResult<FieldRow>>);

    const id1 = await getFieldIdByName('subject');
    expect(id1).toBe('uuid-1');

    clearFieldIdCache();

    const id2 = await getFieldIdByName('subject');
    expect(id2).toBe('uuid-2');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('handles empty result set', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [],
    } as Partial<QueryResult<FieldRow>>);

    const id = await getFieldIdByName('any-field');
    expect(id).toBeNull();
  });

  it('caches multiple fields correctly', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        { id: 'uuid-1', name: 'subject' },
        { id: 'uuid-2', name: 'Case Number' },
        { id: 'uuid-3', name: 'Status' },
        { id: 'uuid-4', name: 'Priority' },
        { id: 'uuid-5', name: 'Assigned To' },
      ],
    } as Partial<QueryResult<FieldRow>>);

    // Load cache first
    const firstId = await getFieldIdByName('subject');
    expect(firstId).toBe('uuid-1');

    // Subsequent calls use cache
    const ids = await Promise.all([
      getFieldIdByName('Case Number'),
      getFieldIdByName('Status'),
      getFieldIdByName('Priority'),
      getFieldIdByName('Assigned To'),
    ]);

    expect(ids).toEqual(['uuid-2', 'uuid-3', 'uuid-4', 'uuid-5']);
    expect(pool.query).toHaveBeenCalledTimes(1); // Only one DB call despite multiple lookups
  });
});
