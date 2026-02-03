# PostgreSQL JSONB Deep Dive - Interactive Learning Session

## Overview
This document captures a hands-on learning session exploring PostgreSQL JSONB as a replacement for Entity-Attribute-Value (EAV) systems. Topics covered include JSONB storage, operators, indexing, nested objects, aggregations, and performance optimization.

## Easy spin a postgres

```
docker run -d --name dummy-postgres -p 5432:5432 -e POSTGRES_PASSWORD=password postgres
docker exec -it dummy-postgres psql -U postgres
```
---

## 1. Creating a JSONB Table

```sql
CREATE TABLE matters (
    id SERIAL PRIMARY KEY,
    matter_number VARCHAR(50),
    attributes JSONB
);
```

**Key concepts:**
- `JSONB` is **binary JSON** - parsed and stored efficiently (faster than regular JSON type)
- Allows flexible schema without ALTER TABLE statements

---

## 2. Inserting JSONB Data

```sql
INSERT INTO matters (matter_number, attributes)
VALUES ('MAT-001', '{"client": "Acme Corp", "status": "active", "budget": 50000}');
```

**Key concepts:**
- JSON is passed as a **string literal in single quotes**
- PostgreSQL validates and parses JSON automatically
- Each row can have completely different attributes (flexible schema)

### Multiple rows with different attributes:

```sql
INSERT INTO matters (matter_number, attributes) VALUES
('MAT-002', '{"client": "Tech Inc", "status": "closed", "priority": "high", "deadline": "2026-03-15"}'),
('MAT-003', '{"client": "Law Firm LLP", "region": "EMEA", "custom_note": "VIP client"}');
```

**EAV replacement benefit:** Each row has different keys without needing ALTER TABLE or complex joins.

---

## 3. JSONB Query Operators

### `->` vs `->>`

```sql
SELECT
    attributes->'client' as arrow_one,    -- Returns JSONB: "Acme Corp"
    attributes->>'client' as arrow_two    -- Returns TEXT: Acme Corp
FROM matters;
```

**Key difference:**
- `->` returns **JSONB** (can be chained for nested objects)
- `->>` returns **TEXT** (final extraction, needs casting for math)

### Extracting and casting values:

```sql
SELECT
    attributes->'budget' as jsonb_budget,           -- JSONB: 50000
    attributes->>'budget' as text_budget,           -- TEXT: '50000'
    (attributes->>'budget')::numeric as numeric_budget  -- NUMERIC: 50000
FROM matters;
```

---

## 4. Filtering by JSONB Attributes

### Filter by value:

```sql
SELECT matter_number, attributes->>'status' as status
FROM matters
WHERE attributes->>'status' = 'active';
```

### Check if key exists (`?` operator):

```sql
SELECT matter_number
FROM matters
WHERE attributes ? 'priority';
```

**Note:** Only returns rows that HAVE the `priority` key, regardless of value.

### List all keys in JSONB (set-returning function):

```sql
SELECT matter_number, jsonb_object_keys(attributes) as keys
FROM matters
WHERE attributes ? 'priority';
```

**Result:** Creates one row per key in the JSONB object (e.g., 4 keys = 4 output rows).

---

## 5. Updating JSONB Data

### Add a new field (merge operator `||`):

```sql
UPDATE matters
SET attributes = attributes || '{"last_updated": "2026-02-04"}'::jsonb
WHERE matter_number = 'MAT-001';
```

**Concept:** Concatenation operator merges new fields into existing JSONB.

### Update a specific field value:

```sql
UPDATE matters
SET attributes = jsonb_set(attributes, '{status}', '"pending"')
WHERE matter_number = 'MAT-001';
```

**Syntax:**
- `jsonb_set(target, path, new_value)`
- Path is an array: `'{status}'` for top-level, `'{parent, child}'` for nested
- New value must be valid JSON with quotes: `'"pending"'`

### Remove a field (`-` operator):

```sql
UPDATE matters
SET attributes = attributes - 'last_updated'
WHERE matter_number = 'MAT-001';
```

**Result:** Key is completely removed from the JSONB object.

---

## 6. Working with Arrays in JSONB

### Insert data with arrays:

```sql
INSERT INTO matters (matter_number, attributes)
VALUES ('MAT-004', '{"client": "Startup Co", "status": "active", "tags": ["litigation", "corporate", "urgent"]}');
```

### Query array containment (`@>` operator):

```sql
SELECT matter_number, attributes->'tags' as tags
FROM matters
WHERE attributes->'tags' @> '"litigation"';
```

**Key points:**
- Use `->` (not `->>`) before `@>` to keep as JSONB
- Value must be in JSON format: `'"litigation"'` (JSON string with quotes)

### Append to array:

```sql
UPDATE matters
SET attributes = jsonb_set(
    attributes,
    '{tags}',
    (attributes->'tags') || '["international"]'::jsonb
)
WHERE matter_number = 'MAT-004';
```

**Concept:** Concatenate existing array with new array using `||`.

---

## 7. Indexing JSONB with GIN

### Create a GIN index:

```sql
CREATE INDEX idx_matters_attributes ON matters USING GIN (attributes);
```

**What GIN (Generalized Inverted Index) does:**
- Inverted index: maps `value → rows` (like a book index)
- Indexes all keys, values, and path-value pairs
- One row can create 7+ index entries
- Makes `@>`, `?`, `?|`, `?&` operators fast

### Check index usage:

```sql
EXPLAIN ANALYZE SELECT * FROM matters WHERE attributes @> '{"status": "active"}';
```

**Look for:** "Bitmap Index Scan on idx_matters_attributes"

### Important notes:
- Small tables (<1000 rows) may use Sequential Scan (cheaper than index)
- Run `ANALYZE matters;` to update statistics
- Indexes are used automatically when cost-effective
- More selective queries (matching fewer rows) benefit more from indexes

### Check index sizes:

```sql
SELECT
    indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE relname = 'matters'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Table and index sizes combined:

```sql
SELECT
    pg_size_pretty(pg_total_relation_size('matters')) AS total_size,
    pg_size_pretty(pg_table_size('matters')) AS table_size,
    pg_size_pretty(pg_indexes_size('matters')) AS indexes_size;
```

---

## 8. GIN Index Deep Dive

### How GIN indexes JSONB:

For a row with: `{"client": "Acme Corp", "status": "active", "budget": 50000}`

**Index entries created:**
1. Key "client" → row pointer
2. Key "status" → row pointer
3. Key "budget" → row pointer
4. Value "Acme Corp" → row pointer
5. Value "active" → row pointer
6. Value 50000 → row pointer
7. Path-value pair "client": "Acme Corp" → row pointer

**Result:** ONE row creates ~7+ index entries (why GIN indexes are large).

### Which queries use GIN efficiently:

```sql
-- FAST - uses index
EXPLAIN ANALYZE SELECT COUNT(*) FROM matters WHERE attributes ? 'priority';

-- FAST - uses index
EXPLAIN ANALYZE SELECT COUNT(*) FROM matters WHERE attributes @> '{"status": "active"}';

-- SLOW - does NOT use index (pattern matching not supported)
EXPLAIN ANALYZE SELECT COUNT(*) FROM matters WHERE attributes->>'client' LIKE '%Corp%';
```

**Key insight:** GIN indexes exact matches and containment, NOT pattern matching.

---

## 9. More JSONB Operators

### Containment operators:

```sql
-- @> "contains" - does LEFT contain RIGHT?
SELECT matter_number FROM matters
WHERE attributes @> '{"status": "active"}';

-- <@ "contained by" - is LEFT contained in RIGHT?
SELECT matter_number FROM matters
WHERE '{"status": "active"}' <@ attributes;
```

### Key existence operators (require ARRAY syntax):

```sql
-- ?| "any keys exist" (OR logic)
SELECT matter_number FROM matters
WHERE attributes ?| ARRAY['priority', 'deadline', 'region']
LIMIT 5;

-- ?& "all keys exist" (AND logic)
SELECT matter_number FROM matters
WHERE attributes ?& ARRAY['client', 'status']
LIMIT 5;
```

**Important:** `?|` and `?&` require **text ARRAY**, not JSONB.

### Difference between key existence and containment:

```sql
-- Check if keys exist (ignore values)
SELECT attributes ?& ARRAY['client', 'status'] FROM matters LIMIT 1;

-- Check if key-value pairs match
SELECT attributes @> '{"client": "Acme Corp", "status": "active"}' FROM matters LIMIT 1;
```

---

## 10. Nested JSONB Objects

### Insert nested structure:

```sql
INSERT INTO matters (matter_number, attributes) VALUES
('MAT-NESTED', '{
  "client": "BigCorp Inc",
  "status": "active",
  "contact": {
    "name": "John Doe",
    "email": "john@bigcorp.com",
    "phone": "+1-555-0100"
  },
  "billing": {
    "rate": 350,
    "currency": "USD",
    "discount": 10
  }
}');
```

### Query nested values (chaining operators):

```sql
SELECT
    matter_number,
    attributes->'contact'->>'name' as contact_name,
    attributes->'contact'->>'email' as contact_email,
    attributes->'billing'->>'rate' as billing_rate
FROM matters
WHERE matter_number = 'MAT-NESTED';
```

**Chain pattern:** Use `->` for each level, `->>` for final text extraction.

### Update nested values:

```sql
UPDATE matters
SET attributes = jsonb_set(
    attributes,
    '{contact, phone}',
    '"+1-555-9999"'
)
WHERE matter_number = 'MAT-NESTED';
```

**Path array:** `'{contact, phone}'` navigates to contact → phone.

### Add new nested field (with create flag):

```sql
UPDATE matters
SET attributes = jsonb_set(
    attributes,
    '{contact, mobile}',
    '"+1-555-1234"',
    true  -- Creates path if it doesn't exist
)
WHERE matter_number = 'MAT-NESTED';
```

---

## 11. GIN Indexes and Nested Queries

### Index usage with nested containment:

```sql
-- USES INDEX (containment check)
EXPLAIN ANALYZE
SELECT * FROM matters
WHERE attributes @> '{"contact": {"name": "John Doe"}}';

-- MAY NOT USE INDEX (navigation + comparison)
EXPLAIN ANALYZE
SELECT * FROM matters
WHERE attributes->'contact'->>'name' = 'John Doe';
```

**Key difference:**
- `@>` with nested JSON uses the GIN index efficiently
- `->` navigation with comparison may trigger Sequential Scan

---

## 12. Aggregating JSONB Data

### Group and aggregate:

```sql
SELECT
    attributes->>'status' as status,
    COUNT(*) as count,
    AVG((attributes->>'budget')::numeric) as avg_budget,
    MIN((attributes->>'budget')::numeric) as min_budget,
    MAX((attributes->>'budget')::numeric) as max_budget
FROM matters
WHERE attributes ? 'budget'
GROUP BY attributes->>'status';
```

**EAV comparison:** In EAV, this would require multiple joins + pivots.

### Count array elements:

```sql
SELECT
    matter_number,
    jsonb_array_length(attributes->'tags') as tag_count
FROM matters
WHERE attributes ? 'tags'
ORDER BY tag_count DESC
LIMIT 5;
```

---

## 13. Building JSONB Dynamically

### Construct JSONB from columns:

```sql
SELECT
    matter_number,
    jsonb_build_object(
        'matter', matter_number,
        'client', attributes->>'client',
        'is_active', (attributes->>'status' = 'active'),
        'metadata', jsonb_build_object(
            'has_tags', attributes ? 'tags',
            'has_budget', attributes ? 'budget'
        )
    ) as response
FROM matters
LIMIT 3;
```

**Use case:** Building API responses from mixed SQL columns and JSONB fields.

### Build arrays:

```sql
SELECT
    jsonb_build_array(
        matter_number,
        attributes->>'client',
        attributes->>'status'
    ) as matter_array
FROM matters
LIMIT 3;
```

### Dynamic vs static JSON:

```sql
-- Static (string literal, hardcoded)
SELECT '["MAT-001", "Acme Corp", "active"]'::jsonb as static_array;

-- Dynamic (handles escaping, types, NULL automatically)
SELECT jsonb_build_array(
    'O''Reilly Books',  -- Single quote handled automatically
    123,                -- Number (not string!)
    true,               -- Boolean
    NULL                -- JSON null
) as built;
```

**Benefits of build functions:**
1. Use column values dynamically
2. Automatic escaping
3. Type conversion (numbers stay numbers)
4. NULL handling

### json vs jsonb:

```sql
SELECT
    json_build_object('a', 'b') as json_version,    -- Spacing: {"a" : "b"}
    jsonb_build_object('a', 'b') as jsonb_version;  -- Compact: {"a":"b"}
```

**Difference:**
- `json` is text storage (preserves formatting, order, duplicate keys)
- `jsonb` is binary storage (parsed, indexed, faster queries)

---

## 14. Iterating Over JSONB Keys

### Extract all key-value pairs:

```sql
SELECT
    matter_number,
    (jsonb_each(attributes)).*
FROM matters
WHERE matter_number = 'MAT-NESTED';
```

**Result:** One row per key-value pair in the JSONB object.

### As text values:

```sql
SELECT
    matter_number,
    key,
    value
FROM matters, jsonb_each_text(attributes)
WHERE matter_number = 'MAT-001'
LIMIT 5;
```

**Difference:**
- `jsonb_each()` returns values as JSONB
- `jsonb_each_text()` returns values as TEXT

### Schema discovery - find all unique keys:

```sql
SELECT DISTINCT key, COUNT(*) as times_used
FROM matters, jsonb_each(attributes)
GROUP BY key
ORDER BY times_used DESC;
```

**Use case:** Discover what attributes exist across all rows in flexible schema.

---

## 15. Aggregating INTO JSONB

### Aggregate values into JSONB array:

```sql
SELECT
    attributes->>'status' as status,
    jsonb_agg(matter_number) as matter_numbers,
    COUNT(*) as total
FROM matters
WHERE attributes ? 'status'
GROUP BY attributes->>'status'
LIMIT 5;
```

**Result:** `["MAT-001", "MAT-002", ...]` as JSONB array.

### Aggregate entire objects:

```sql
SELECT
    attributes->>'status' as status,
    jsonb_agg(
        jsonb_build_object(
            'matter', matter_number,
            'client', attributes->>'client'
        )
    ) as matters
FROM matters
WHERE attributes ? 'status' AND attributes ? 'client'
GROUP BY attributes->>'status'
LIMIT 3;
```

**Result:** Array of objects: `[{"matter": "MAT-001", "client": "Acme"}, ...]`

**Use case:** Building nested API responses, grouping related data.

---

## 16. Alternative GIN Index: jsonb_path_ops

### Two types of GIN indexes:

```sql
-- Default: jsonb_ops (what we've been using)
CREATE INDEX idx_matters_attributes ON matters USING GIN (attributes);

-- Alternative: jsonb_path_ops
CREATE INDEX idx_matters_attrs_pathops ON matters USING GIN (attributes jsonb_path_ops);
```

### Comparison:

| Feature | jsonb_ops (default) | jsonb_path_ops |
|---------|-------------------|----------------|
| **Supports** | ALL operators: `?`, `?|`, `?&`, `@>`, `<@` | ONLY `@>` (containment) |
| **Indexes** | Keys AND values separately | Only path-value combinations |
| **Size** | Larger | ~30% smaller |
| **Speed** | Fast | Slightly faster for `@>` |

### When to use which:

**Use `jsonb_ops` (default) when:**
- You need key existence checks: `?`, `?|`, `?&`
- You use mixed query patterns
- **Most common choice** - supports everything

**Use `jsonb_path_ops` when:**
- You ONLY query with `@>` (containment)
- Index size matters (storage constraints, high write volume)

**Best practice:** Choose ONE index based on your query patterns. Having both is redundant.

---

## Key Takeaways

### Why JSONB beats EAV:

1. **Performance:** One query instead of multiple joins
2. **Flexibility:** Add fields without ALTER TABLE
3. **Indexing:** GIN indexes are very fast for key/value lookups
4. **Atomic updates:** Update entire document in one operation
5. **Type safety:** JSONB validates JSON structure
6. **Simpler queries:** No complex JOIN logic

### Best Practices:

1. **Use GIN indexes** on JSONB columns for production workloads
2. **Run ANALYZE** after bulk inserts/updates to update statistics
3. **Choose index type** based on query patterns (usually default jsonb_ops)
4. **Use `@>` containment** instead of `->` navigation for index usage
5. **Cast appropriately:** Use `->>` then cast to numeric/date for comparisons
6. **Validate at boundaries:** Ensure JSON structure matches expectations

### Common Patterns:

```sql
-- Flexible attribute storage
attributes JSONB

-- Fast containment queries
WHERE attributes @> '{"status": "active"}'

-- Key existence
WHERE attributes ? 'field_name'

-- Array containment
WHERE attributes->'tags' @> '"litigation"'

-- Nested navigation
attributes->'contact'->>'email'

-- Dynamic construction
jsonb_build_object('key', value, ...)

-- Aggregation
jsonb_agg(column_or_object)
```

---

## Session Commands for Quick Reference

```sql
-- Create table
CREATE TABLE matters (id SERIAL PRIMARY KEY, matter_number VARCHAR(50), attributes JSONB);

-- Insert
INSERT INTO matters (matter_number, attributes) VALUES ('MAT-001', '{"key": "value"}');

-- Query
SELECT attributes->>'key' FROM matters WHERE attributes @> '{"status": "active"}';

-- Update
UPDATE matters SET attributes = attributes || '{"new_key": "value"}'::jsonb;
UPDATE matters SET attributes = jsonb_set(attributes, '{key}', '"new_value"');
UPDATE matters SET attributes = attributes - 'key_to_remove';

-- Index
CREATE INDEX idx_matters_attributes ON matters USING GIN (attributes);
ANALYZE matters;

-- Build
jsonb_build_object('key', value, 'nested', jsonb_build_object('k', 'v'))
jsonb_build_array(val1, val2, val3)

-- Aggregate
SELECT jsonb_agg(column) FROM table;
SELECT jsonb_agg(jsonb_build_object('k', col)) FROM table;

-- Iterate
SELECT key, value FROM table, jsonb_each(attributes);

-- Check sizes
SELECT pg_size_pretty(pg_indexes_size('matters'));
```

---

**End of Session**

This deep dive covered the essential JSONB operations needed to replace EAV systems with flexible, performant JSONB columns in PostgreSQL.
