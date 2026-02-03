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
