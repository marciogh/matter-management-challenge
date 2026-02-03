# Task 3: Implement Search Functionality

## Overview
Implement full-text search across all field types in the Matter Management System using PostgreSQL's pg_trgm extension for fuzzy matching. Search should work across text, numbers, status labels, user names, and handle debouncing on the frontend (500ms).

## Requirements Summary
- Search across all field types: text, number, date, boolean, currency, user, select, status
- Use PostgreSQL pg_trgm for fuzzy text matching (already enabled and indexed)
- Frontend debouncing (500ms delay before triggering API call)
- Handle NULL values gracefully
- Reset pagination to page 1 when search query changes
- Work seamlessly with existing sorting functionality
- Display appropriate loading states and empty results messages

---

## Database Analysis

### Existing pg_trgm Indexes (Already Created)
```sql
-- From database/schema.sql (lines 160-161)
CREATE INDEX idx_ticket_field_value_text_trgm
  ON ticketing_ticket_field_value USING gin (text_value gin_trgm_ops);

CREATE INDEX idx_ticket_field_value_string_trgm
  ON ticketing_ticket_field_value USING gin (string_value gin_trgm_ops);
```

These GIN indexes enable fast trigram-based fuzzy searching on text fields.

### Search Strategy by Field Type

| Field Type | Storage Column | Search Strategy |
|------------|----------------|-----------------|
| `text` | `text_value` | `ILIKE '%search%'` with pg_trgm index |
| `number` | `number_value` | Cast to text: `CAST(number_value AS TEXT) ILIKE '%search%'` |
| `date` | `date_value` | Format and search: `TO_CHAR(date_value, 'YYYY-MM-DD') ILIKE '%search%'` |
| `boolean` | `boolean_value` | Match 'true'/'false' or '✓'/'✗' |
| `currency` | `currency_value` (JSONB) | Search amount: `CAST((currency_value->>'amount') AS TEXT) ILIKE '%search%'` |
| `user` | `user_value` (FK) | Join users table: `CONCAT(u.first_name, ' ', u.last_name) ILIKE '%search%'` |
| `select` | `select_reference_value_uuid` (FK) | Join options table: `tfo.label ILIKE '%search%'` |
| `status` | `status_reference_value_uuid` (FK) | Join status options: `tfso.label ILIKE '%search%'` |

### Connection to Local PostgreSQL

For testing queries directly:
```bash
docker exec -it mypostgres psql -U postgres -d matter_management
```

---

## Backend Implementation

### New File: `backend/src/ticketing/matter/utils/search_query_builder.ts`

Create a utility to build search SQL conditions across all field types:

```typescript
import { PoolClient } from 'pg';

export interface SearchQueryResult {
  searchCondition: string;
  searchParams: string[];
  searchJoins: string;
}

/**
 * Build search WHERE conditions and JOINs for all field types
 *
 * @param searchTerm - User's search input
 * @param client - Database client for field metadata queries
 * @param startParamIndex - Starting parameter index (for $1, $2, etc.)
 * @returns SQL fragments and parameters for search
 */
export async function buildSearchQuery(
  searchTerm: string,
  client: PoolClient,
  startParamIndex: number = 1,
): Promise<SearchQueryResult> {

  if (!searchTerm || searchTerm.trim() === '') {
    return {
      searchCondition: '',
      searchParams: [],
      searchJoins: '',
    };
  }

  const trimmedSearch = searchTerm.trim();
  const searchPattern = `%${trimmedSearch}%`;
  const paramIndex = startParamIndex;

  // Build comprehensive search conditions
  const conditions: string[] = [];
  const params: string[] = [];

  // Search in text fields (text_value and string_value)
  conditions.push(`ttfv_search.text_value ILIKE $${paramIndex}`);
  conditions.push(`ttfv_search.string_value ILIKE $${paramIndex}`);
  params.push(searchPattern);

  // Search in number fields (cast to text)
  conditions.push(`CAST(ttfv_search.number_value AS TEXT) ILIKE $${paramIndex}`);

  // Search in date fields (format as ISO date string)
  conditions.push(`TO_CHAR(ttfv_search.date_value, 'YYYY-MM-DD') ILIKE $${paramIndex}`);

  // Search in boolean fields (match 'true', 'false', or visual symbols)
  const lowerSearch = trimmedSearch.toLowerCase();
  if (lowerSearch.includes('true') || lowerSearch.includes('yes') || lowerSearch.includes('✓')) {
    conditions.push(`ttfv_search.boolean_value = true`);
  }
  if (lowerSearch.includes('false') || lowerSearch.includes('no') || lowerSearch.includes('✗')) {
    conditions.push(`ttfv_search.boolean_value = false`);
  }

  // Search in currency amount (extract from JSONB)
  conditions.push(`CAST((ttfv_search.currency_value->>'amount') AS TEXT) ILIKE $${paramIndex}`);

  // Search in user names (join to users table)
  conditions.push(`CONCAT(u_search.first_name, ' ', u_search.last_name) ILIKE $${paramIndex}`);

  // Search in select option labels
  conditions.push(`tfo_search.label ILIKE $${paramIndex}`);

  // Search in status option labels
  conditions.push(`tfso_search.label ILIKE $${paramIndex}`);

  // Combine all conditions with OR
  const searchCondition = `
    AND EXISTS (
      SELECT 1
      FROM ticketing_ticket_field_value ttfv_search
      LEFT JOIN users u_search ON ttfv_search.user_value = u_search.id
      LEFT JOIN ticketing_field_options tfo_search
        ON ttfv_search.select_reference_value_uuid = tfo_search.id
      LEFT JOIN ticketing_field_status_options tfso_search
        ON ttfv_search.status_reference_value_uuid = tfso_search.id
      WHERE ttfv_search.ticket_id = tt.id
        AND (
          ${conditions.join('\n          OR ')}
        )
    )
  `;

  return {
    searchCondition,
    searchParams: params,
    searchJoins: '', // Using EXISTS subquery, so no main query joins needed
  };
}
```

**Why EXISTS Subquery?**
- Avoids cartesian products with the sort JOINs (ttfv_sort uses same table)
- No need for DISTINCT (which breaks certain ORDER BY clauses)
- More efficient for PostgreSQL optimizer when searching across multiple field types
- Keeps main query clean and focused on sorting/pagination

**Alternative Approach (Broad JOIN):**
If performance testing shows the EXISTS subquery is slower, use a LEFT JOIN with DISTINCT:
```sql
LEFT JOIN ticketing_ticket_field_value ttfv_search ON tt.id = ttfv_search.ticket_id
-- ... all the search joins
WHERE (conditions OR ...)
```

But this requires `DISTINCT ON (tt.id)` which complicates sorting.

---

### Modified: `backend/src/ticketing/matter/repo/matter_repo.ts`

Update the `getMatters()` method to use search query builder:

**Lines 1-7: Add Import**
```typescript
import pool from '../../../db/pool.js';
import { Matter, MatterListParams, FieldValue, UserValue, CurrencyValue, StatusValue } from '../../types.js';
import logger from '../../../utils/logger.js';
import { PoolClient } from 'pg';
import { getSortFieldConfig } from '../utils/sort_field_mapper.js';
import { buildSortQuery } from '../utils/sort_query_builder.js';
import { getFieldIdByName } from '../utils/field_id_resolver.js';
import { buildSearchQuery } from '../utils/search_query_builder.js';  // NEW
```

**Lines 32-43: Update Search Logic**

Replace:
```typescript
// TODO: Implement search condition
// Currently search is not implemented - add ILIKE queries with pg_trgm
const searchCondition = '';
const queryParams: (string | number)[] = [];
const paramIndex = 1;
```

With:
```typescript
// Build search condition
const queryParams: (string | number)[] = [];
let paramIndex = 1;

const searchResult = await buildSearchQuery(params.search || '', client, paramIndex);
const searchCondition = searchResult.searchCondition;
queryParams.push(...searchResult.searchParams);
paramIndex += searchResult.searchParams.length;
```

**Lines 61-78: Update Queries to Use Search**

The count query and matters query already use `${searchCondition}`, so they'll automatically include search when it's present.

Verify the queries have the WHERE clause placeholder:
```sql
-- Count query (line 61-65)
SELECT COUNT(*) as total
FROM ticketing_ticket tt
WHERE 1=1 ${searchCondition}

-- Matters query (line 71-78)
SELECT tt.id, tt.board_id, tt.created_at, tt.updated_at
FROM ticketing_ticket tt
${sortJoinClause}
WHERE 1=1 ${searchCondition}
ORDER BY ${orderByClause}
LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
```

**Important:** Update the LIMIT/OFFSET parameter indexes to account for search params:
```typescript
queryParams.push(limit, offset);
const mattersResult = await client.query(mattersQuery, queryParams);
```

---

### Modified: `backend/src/ticketing/matter/handlers/getMatters.ts`

The search parameter is already defined in the Zod schema (line 18):
```typescript
search: z.string().optional().default(''),
```

**Optional Enhancement: Add search term length validation**
```typescript
search: z.string()
  .optional()
  .default('')
  .transform(val => val.trim())
  .refine(val => val.length === 0 || val.length >= 2, {
    message: 'Search term must be at least 2 characters',
  }),
```

This prevents single-character searches which can be slow and less meaningful.

---

### Modified: `backend/src/ticketing/matter/service/matter_service.ts`

No changes needed. The service already passes the `search` parameter from `MatterListParams` to the repository.

---

## Frontend Implementation

### New File: `frontend/src/components/SearchBar.tsx`

Create a search input component with debouncing UI:

```typescript
import { useState, useEffect } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function SearchBar({ value, onChange, isLoading = false, placeholder = 'Search matters...' }: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isDebouncing, setIsDebouncing] = useState(false);

  // Sync with parent value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Handle input change with debounce indicator
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);
    setIsDebouncing(true);

    // Trigger parent onChange immediately for very fast feedback
    onChange(newValue);
  };

  // Clear debouncing indicator after delay
  useEffect(() => {
    if (isDebouncing) {
      const timer = setTimeout(() => setIsDebouncing(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isDebouncing]);

  const handleClear = () => {
    setLocalValue('');
    onChange('');
  };

  return (
    <div className="relative">
      <div className="relative">
        {/* Search Icon */}
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg
            className="h-5 w-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Input Field */}
        <input
          type="text"
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          className="block w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />

        {/* Clear Button / Loading Spinner */}
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
          {isLoading ? (
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          ) : localValue ? (
            <button
              onClick={handleClear}
              className="text-gray-400 hover:text-gray-600 focus:outline-none"
              aria-label="Clear search"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Debounce Indicator (optional visual feedback) */}
      {isDebouncing && (
        <div className="absolute top-full left-0 mt-1 text-xs text-gray-500">
          Searching...
        </div>
      )}
    </div>
  );
}
```

**Features:**
- Search icon on left
- Clear button (X) on right when text is present
- Loading spinner during API call
- Debounce indicator for user feedback
- Matches existing Tailwind styling patterns
- Full keyboard accessibility

---

### Modified: `frontend/src/App.tsx`

Update to integrate SearchBar with debouncing:

**Lines 6-11: Update State Management**

Replace:
```typescript
const [search] = useState(''); // TODO: Implement search state management
```

With:
```typescript
const [searchInput, setSearchInput] = useState('');  // Immediate input value
const [search, setSearch] = useState('');             // Debounced value sent to API
```

**After imports: Add Debouncing Effect**

```typescript
import { SearchBar } from './components/SearchBar';  // Add to imports

// ... existing state ...

// Debounce search input (500ms)
useEffect(() => {
  const timer = setTimeout(() => {
    setSearch(searchInput);
    setPage(1); // Reset to first page when search changes
  }, 500);

  return () => clearTimeout(timer);
}, [searchInput]);
```

**Lines 45-62: Replace TODO Banner with SearchBar**

Replace:
```typescript
<div className="mb-4">
  {/* TODO: Implement search functionality */}
  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
    <div className="flex">
      <div className="flex-shrink-0">
        <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="..." clipRule="evenodd" />
        </svg>
      </div>
      <div className="ml-3">
        <p className="text-sm text-yellow-700">
          <strong>Assessment Task:</strong> Search functionality needs to be implemented...
        </p>
      </div>
    </div>
  </div>
</div>
```

With:
```typescript
<div className="mb-4">
  <SearchBar
    value={searchInput}
    onChange={setSearchInput}
    isLoading={loading}
    placeholder="Search matters by case number, subject, status, assignee, or any field..."
  />
</div>
```

**Add Search Result Indicator (optional enhancement):**

After SearchBar, before the white card:
```typescript
{search && !loading && (
  <div className="mb-4 text-sm text-gray-600">
    {total > 0 ? (
      <span>Found <strong>{total}</strong> matter{total !== 1 ? 's' : ''} matching "{search}"</span>
    ) : (
      <span>No matters found matching "{search}"</span>
    )}
  </div>
)}
```

---

### Modified: `frontend/src/hooks/useMatters.ts`

No changes needed! The hook already includes `search` in:
- `UseMatterParams` interface (line 11)
- URL query parameters (line 31)
- `useEffect` dependency array (line 48)

The search parameter flows automatically from App.tsx → useMatters → backend API.

---

## Files to Modify

| File | Action | Changes |
|------|--------|---------|
| `backend/src/ticketing/matter/utils/search_query_builder.ts` | **Create** | Search condition builder for all field types |
| `backend/src/ticketing/matter/repo/matter_repo.ts` | **Modify** | Import and use search query builder (lines 7, 39-43) |
| `backend/src/ticketing/matter/handlers/getMatters.ts` | **Modify** | Optional: Add search term length validation |
| `frontend/src/components/SearchBar.tsx` | **Create** | Search input component with clear button and loading state |
| `frontend/src/App.tsx` | **Modify** | Add SearchBar, debounce logic, state management |

---

## Key Design Decisions

### EXISTS Subquery vs. Broad JOIN

**Choice: EXISTS Subquery**

**Rationale:**
1. **No DISTINCT needed:** The EXISTS subquery doesn't multiply rows, so no DISTINCT is required
2. **Sorting compatibility:** ORDER BY can reference any column without DISTINCT conflicts
3. **Join isolation:** Search JOINs don't interfere with sort JOINs (both use ttfv table with different aliases)
4. **Performance:** PostgreSQL optimizes EXISTS subqueries efficiently with semi-joins
5. **Maintainability:** Clear separation between search logic and main query

**Trade-off:** Subquery executes for each row, but with proper indexes this is fast.

### Search Across All Field Types Simultaneously

Rather than requiring users to specify which field to search, the implementation searches ALL fields. This provides the best user experience:
- User types "Smith" → finds matters assigned to John Smith, or with "Smith" in subject
- User types "5000" → finds matters with case number 5000 or contract value $5000
- User types "Active" → finds matters with "Active" status

### Debouncing Strategy

**Implementation:** Debounce on frontend (500ms delay before API call)

**Why not backend debouncing?**
- Frontend debouncing reduces API calls (less server load)
- Backend sees fewer requests, can cache more effectively
- User gets immediate visual feedback (input updates instantly)
- API calls only trigger after user stops typing

**Debounce Duration:** 500ms is the sweet spot:
- Fast enough to feel responsive
- Long enough to avoid most mid-typing queries
- Matches industry standards (Google, Amazon use 300-500ms)

### Case-Insensitive Search with ILIKE

Using `ILIKE` instead of `LIKE` or full-text search operators because:
- Case-insensitive by default (user doesn't need to match case)
- Works with pg_trgm indexes (GIN indexes on text_value/string_value)
- Simpler than setting up full-text search vectors
- Sufficient for the assessment's 10,000 matter dataset

For 100K+ matters, consider upgrading to:
- PostgreSQL `ts_vector` and `ts_query` for full-text search
- Elasticsearch for advanced search features
- Materialized views with pre-computed search columns

### Boolean Search Handling

Booleans are tricky to search since they're stored as true/false but displayed as "✓" or "✗".

**Solution:** Check if search term contains:
- 'true', 'yes', '✓' → match `boolean_value = true`
- 'false', 'no', '✗' → match `boolean_value = false`

### Pagination Reset on Search

When search changes, reset to page 1 (line in useEffect):
```typescript
setPage(1); // Reset to first page when search changes
```

**Why?** User searching for "Smith" might be on page 5 of all matters. New search results are different, so page 5 might not exist. Always start at page 1 for new searches.

### SQL Injection Prevention

Using parameterized queries throughout:
```typescript
// Safe - search term is a parameter
conditions.push(`ttfv_search.text_value ILIKE $${paramIndex}`);
params.push(`%${trimmedSearch}%`);
```

Never concatenate user input into SQL strings.

---

## Performance Considerations

### Existing Indexes Support Search

The database already has GIN indexes optimized for ILIKE queries:
```sql
CREATE INDEX idx_ticket_field_value_text_trgm
  ON ticketing_ticket_field_value USING gin (text_value gin_trgm_ops);

CREATE INDEX idx_ticket_field_value_string_trgm
  ON ticketing_ticket_field_value USING gin (string_value gin_trgm_ops);
```

**Why pg_trgm?**
- Enables fast ILIKE with wildcards (`%search%`)
- Trigram-based fuzzy matching (finds "Smith" even if typed "Smi")
- GIN index size is ~30% of data size (acceptable for 10K matters)

### Query Performance Analysis

For the 10,000 matter dataset:
- **Text/string search:** ~5-15ms (using GIN indexes)
- **Number/date search:** ~10-20ms (sequential scan with cast, but small dataset)
- **User/status search:** ~15-25ms (includes JOIN to reference tables)
- **Overall:** <50ms for most queries (well within acceptable range)

### Optimization for 10× Load (100,000 matters)

1. **Add More Indexes:**
   ```sql
   -- Number search (cast to text is slow without index)
   CREATE INDEX idx_ttfv_number_text ON ticketing_ticket_field_value
     (CAST(number_value AS TEXT)) WHERE number_value IS NOT NULL;

   -- User name search
   CREATE INDEX idx_users_fullname ON users
     (CONCAT(first_name, ' ', last_name));

   -- Status label search
   CREATE INDEX idx_status_label_trgm ON ticketing_field_status_options
     USING gin (label gin_trgm_ops);
   ```

2. **Caching Strategy:**
   - Redis cache for search results (key: search term + sort + page)
   - Cache duration: 5 minutes
   - Cache invalidation: On matter updates
   - Estimated hit rate: 40-60% (many users search similar terms)

3. **Query Optimization:**
   - Use `EXPLAIN ANALYZE` to profile slow queries
   - Consider materialized view for frequently searched fields
   - Implement search result pagination with cursor-based approach

4. **Consider Elasticsearch:**
   - For 100K+ matters with complex search requirements
   - Better handling of typos, synonyms, relevance ranking
   - Can search across multiple tables more efficiently

---

## Testing Strategy

### Unit Tests

**File:** `backend/src/ticketing/matter/__tests__/search_query_builder.test.ts`

```typescript
describe('buildSearchQuery', () => {
  it('returns empty condition when search term is empty', async () => {
    const result = await buildSearchQuery('', mockClient, 1);
    expect(result.searchCondition).toBe('');
    expect(result.searchParams).toEqual([]);
  });

  it('builds ILIKE conditions for text search', async () => {
    const result = await buildSearchQuery('contract', mockClient, 1);
    expect(result.searchCondition).toContain('ILIKE $1');
    expect(result.searchParams).toEqual(['%contract%']);
  });

  it('includes user name search with JOIN', async () => {
    const result = await buildSearchQuery('Smith', mockClient, 1);
    expect(result.searchCondition).toContain('u_search');
    expect(result.searchCondition).toContain('first_name');
  });

  it('handles boolean search terms', async () => {
    const result = await buildSearchQuery('true', mockClient, 1);
    expect(result.searchCondition).toContain('boolean_value = true');
  });

  it('trims whitespace from search term', async () => {
    const result = await buildSearchQuery('  test  ', mockClient, 1);
    expect(result.searchParams).toEqual(['%test%']);
  });

  it('uses correct parameter index', async () => {
    const result = await buildSearchQuery('search', mockClient, 5);
    expect(result.searchCondition).toContain('$5');
  });
});
```

### Integration Tests

**File:** `backend/src/ticketing/matter/__tests__/matter_repo_search.test.ts`

```typescript
describe('MatterRepo - Search Integration', () => {
  it('finds matters by text field content', async () => {
    const result = await matterRepo.getMatters({
      page: 1,
      limit: 25,
      sortBy: 'created_at',
      sortOrder: 'desc',
      search: 'contract dispute',
    });

    expect(result.matters.length).toBeGreaterThan(0);
    expect(result.matters[0].fields['subject'].value).toContain('contract');
  });

  it('finds matters by case number', async () => {
    const result = await matterRepo.getMatters({ search: '12345' });

    expect(result.matters.some(m =>
      m.fields['Case Number'].value.toString().includes('12345')
    )).toBe(true);
  });

  it('finds matters by assigned user name', async () => {
    const result = await matterRepo.getMatters({ search: 'Alice Brown' });

    expect(result.matters.some(m =>
      m.fields['Assigned To'].displayValue === 'Alice Brown'
    )).toBe(true);
  });

  it('finds matters by status label', async () => {
    const result = await matterRepo.getMatters({ search: 'Active' });

    expect(result.matters.some(m =>
      m.fields['Status'].displayValue === 'Active'
    )).toBe(true);
  });

  it('returns empty results for non-matching search', async () => {
    const result = await matterRepo.getMatters({
      search: 'xyznonexistent999'
    });

    expect(result.matters).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('works with sorting and pagination', async () => {
    const result = await matterRepo.getMatters({
      search: 'contract',
      sortBy: 'Case Number',
      sortOrder: 'asc',
      page: 2,
      limit: 10,
    });

    expect(result.matters.length).toBeLessThanOrEqual(10);
    // Verify sort order is maintained
  });

  it('resets to page 1 when search changes (frontend behavior)', async () => {
    // This is tested in frontend tests, but verify backend handles it
    const result = await matterRepo.getMatters({
      search: 'new search',
      page: 1,  // Frontend should reset to page 1
      limit: 25,
    });

    expect(result.matters.length).toBeLessThanOrEqual(25);
  });
});
```

### Frontend Component Tests

**File:** `frontend/src/components/__tests__/SearchBar.test.tsx`

```typescript
describe('SearchBar', () => {
  it('renders with placeholder text', () => {
    render(<SearchBar value="" onChange={vi.fn()} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('displays current value', () => {
    render(<SearchBar value="test search" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('test search')).toBeInTheDocument();
  });

  it('calls onChange when user types', () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'new search' }
    });

    expect(handleChange).toHaveBeenCalledWith('new search');
  });

  it('shows clear button when value is present', () => {
    render(<SearchBar value="test" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('clears value when clear button is clicked', () => {
    const handleChange = vi.fn();
    render(<SearchBar value="test" onChange={handleChange} />);

    fireEvent.click(screen.getByLabelText('Clear search'));

    expect(handleChange).toHaveBeenCalledWith('');
  });

  it('shows loading spinner when isLoading is true', () => {
    render(<SearchBar value="test" onChange={vi.fn()} isLoading={true} />);
    expect(screen.getByRole('textbox').parentElement).toContainHTML('animate-spin');
  });
});
```

### Frontend Integration Tests

**File:** `frontend/src/__tests__/App.search.test.tsx`

```typescript
describe('App - Search Integration', () => {
  it('debounces search input by 500ms', async () => {
    render(<App />);
    const searchInput = screen.getByPlaceholderText(/search matters/i);

    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Immediately after typing, API should not be called yet
    expect(global.fetch).not.toHaveBeenCalled();

    // After 500ms, API should be called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test')
      );
    }, { timeout: 600 });
  });

  it('resets to page 1 when search changes', async () => {
    render(<App />);

    // Navigate to page 2
    const page2Button = screen.getByText('2');
    fireEvent.click(page2Button);

    // Type search term
    const searchInput = screen.getByPlaceholderText(/search matters/i);
    fireEvent.change(searchInput, { target: { value: 'contract' } });

    // Wait for debounce and verify page reset
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('page=1')
      );
    });
  });

  it('shows search result count', async () => {
    render(<App />);
    const searchInput = screen.getByPlaceholderText(/search matters/i);

    fireEvent.change(searchInput, { target: { value: 'test' } });

    await waitFor(() => {
      expect(screen.getByText(/Found \d+ matter/i)).toBeInTheDocument();
    });
  });
});
```

---

## Verification Plan

### 1. Backend Search Testing (via API)

Start the application:
```bash
docker compose up
```

Connect to PostgreSQL for query inspection:
```bash
docker exec -it mypostgres psql -U postgres -d matter_management
```

Test search endpoints with curl:

```bash
# Search in text fields (subject, description)
curl "http://localhost:3000/api/v1/matters?search=contract&page=1&limit=25"

# Search by case number
curl "http://localhost:3000/api/v1/matters?search=1234&page=1&limit=25"

# Search by user name
curl "http://localhost:3000/api/v1/matters?search=Alice&page=1&limit=25"

# Search by status
curl "http://localhost:3000/api/v1/matters?search=Active&page=1&limit=25"

# Search with sorting
curl "http://localhost:3000/api/v1/matters?search=contract&sortBy=Case%20Number&sortOrder=asc"

# Empty search returns all matters
curl "http://localhost:3000/api/v1/matters?search=&page=1&limit=25"

# Non-matching search returns empty results
curl "http://localhost:3000/api/v1/matters?search=xyznonexistent999&page=1&limit=25"
```

Verify response structure:
```json
{
  "data": [...],  // Array of matching matters
  "total": 123,   // Total matching matters
  "page": 1,
  "limit": 25,
  "totalPages": 5
}
```

### 2. Frontend Search Testing

Open application: http://localhost:8080

**Manual Test Cases:**

1. **Basic Search:**
   - Type "contract" in search bar
   - Verify results update after 500ms
   - Verify loading spinner appears during search
   - Verify result count displays

2. **Debouncing:**
   - Type "test" quickly, then pause
   - Verify only one API call after 500ms
   - Open browser DevTools Network tab to observe

3. **Clear Button:**
   - Type search term
   - Click X button
   - Verify search clears and shows all matters

4. **Search + Sort:**
   - Search for "contract"
   - Click "Case Number" column header
   - Verify sorted results maintain search filter

5. **Search + Pagination:**
   - Search for common term (e.g., "contract")
   - Navigate to page 2
   - Verify pagination works with search results

6. **Pagination Reset:**
   - Navigate to page 3
   - Type new search term
   - Verify pagination resets to page 1

7. **Empty Results:**
   - Search for "xyznonexistent999"
   - Verify empty state message displays
   - Verify "No matters found" message

8. **Search All Field Types:**
   - Number: "5000"
   - Date: "2024"
   - User: "Smith"
   - Status: "Done"
   - Priority: "High"
   - Currency: "10000"

### 3. Performance Testing

**Query Performance:**
```sql
-- Connect to database
docker exec -it mypostgres psql -U postgres -d matter_management

-- Analyze search query performance
EXPLAIN ANALYZE
SELECT tt.id
FROM ticketing_ticket tt
WHERE EXISTS (
  SELECT 1
  FROM ticketing_ticket_field_value ttfv_search
  LEFT JOIN users u_search ON ttfv_search.user_value = u_search.id
  WHERE ttfv_search.ticket_id = tt.id
    AND (
      ttfv_search.text_value ILIKE '%contract%'
      OR ttfv_search.string_value ILIKE '%contract%'
      OR CONCAT(u_search.first_name, ' ', u_search.last_name) ILIKE '%contract%'
    )
)
LIMIT 25;
```

Expected performance for 10,000 matters:
- Query execution time: <50ms
- Index usage: Should use `idx_ticket_field_value_text_trgm`
- Rows scanned: Should be minimal with indexes

**Load Testing (optional):**
```bash
# Install Apache Bench
brew install httpd  # macOS

# Test concurrent search requests
ab -n 100 -c 10 "http://localhost:3000/api/v1/matters?search=contract"
```

Expected results:
- Mean response time: <100ms
- No failed requests
- Consistent performance across requests

### 4. Edge Cases

Test these scenarios:

- **Empty search:** Returns all matters (10,000)
- **Single character:** "a" (might return many results)
- **Special characters:** "contract's", "O'Brien", "@#$%"
- **Very long search:** 100+ character string
- **Unicode characters:** "café", "日本"
- **SQL injection attempt:** "'; DROP TABLE--" (should be safely parameterized)
- **Search while loading:** Type quickly before previous results load

### 5. Browser Compatibility

Test in multiple browsers:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

Verify:
- Search input works
- Debouncing functions correctly
- Clear button appears and works
- Loading states display properly

---

## Implementation Order

1. **Backend - Search Query Builder** (30 min)
   - Create `search_query_builder.ts` with buildSearchQuery function
   - Implement search condition logic for all field types
   - Add unit tests for search query builder

2. **Backend - Repository Integration** (15 min)
   - Update `matter_repo.ts` to import and use search builder
   - Update parameter indexing to account for search params
   - Test with curl commands

3. **Backend - Handler Enhancement** (10 min)
   - Optional: Add search term length validation to Zod schema
   - Test validation edge cases

4. **Frontend - SearchBar Component** (45 min)
   - Create `SearchBar.tsx` component
   - Implement clear button and loading state
   - Add component tests

5. **Frontend - App Integration** (20 min)
   - Update `App.tsx` with searchInput and search state
   - Implement debouncing with useEffect
   - Replace TODO banner with SearchBar
   - Add search result indicator

6. **Integration Testing** (30 min)
   - Test search + sort combinations
   - Test search + pagination
   - Test all field types
   - Verify edge cases

7. **Performance Verification** (15 min)
   - Run EXPLAIN ANALYZE on search queries
   - Verify index usage
   - Check response times

8. **Documentation** (10 min)
   - Update README.md with search implementation notes
   - Document any performance considerations

**Total Estimated Time:** ~3 hours

---

## Success Criteria

- [ ] Search works across all 8 field types
- [ ] Debouncing delays API calls by 500ms
- [ ] Search results display correctly with loading states
- [ ] Pagination resets to page 1 on new search
- [ ] Search works with existing sorting functionality
- [ ] Empty search returns all matters
- [ ] Non-matching search shows appropriate empty state
- [ ] Clear button removes search and resets results
- [ ] No TypeScript errors in frontend
- [ ] No SQL errors or N+1 query problems
- [ ] Performance <50ms for most searches on 10K dataset
- [ ] Unit tests cover search query builder
- [ ] Integration tests verify search + sort + pagination

---

## Scalability Considerations for 10× Load

### Current Implementation (10,000 matters)
- EXISTS subquery with pg_trgm indexes
- Response time: <50ms average
- No caching (direct database queries)

### For 100,000 matters:

**1. Database Optimizations:**
```sql
-- Add composite indexes for common search patterns
CREATE INDEX idx_ttfv_text_ticket ON ticketing_ticket_field_value(ticket_id, text_value)
  WHERE text_value IS NOT NULL;

-- Partition large tables by date
CREATE TABLE ticketing_ticket_2024 PARTITION OF ticketing_ticket
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

-- Add partial indexes for frequently searched fields
CREATE INDEX idx_ttfv_subject ON ticketing_ticket_field_value(text_value)
  WHERE ticket_field_id = (SELECT id FROM ticketing_fields WHERE name = 'subject');
```

**2. Caching Strategy:**
- **Redis cache** for search results
- Cache key: `search:${searchTerm}:${sortBy}:${sortOrder}:${page}`
- TTL: 5 minutes
- Cache invalidation: On matter updates
- Expected hit rate: 40-60%

**3. Search Optimization:**
- **Implement search result pagination with cursors** instead of OFFSET
- **Pre-compute search vectors** for common fields
- **Use PostgreSQL ts_vector** for full-text search instead of ILIKE
- **Consider Elasticsearch** for advanced search features:
  - Better performance on large datasets
  - Fuzzy matching and typo tolerance
  - Relevance scoring
  - Faceted search (filter by status, assignee, etc.)

**4. Query Optimization:**
```sql
-- Materialized view for frequently searched data
CREATE MATERIALIZED VIEW matter_search_view AS
SELECT
  tt.id,
  string_agg(DISTINCT ttfv.text_value, ' ') as all_text,
  string_agg(DISTINCT ttfv.string_value, ' ') as all_strings,
  string_agg(DISTINCT u.first_name || ' ' || u.last_name, ' ') as all_users,
  string_agg(DISTINCT tfso.label, ' ') as all_statuses
FROM ticketing_ticket tt
LEFT JOIN ticketing_ticket_field_value ttfv ON tt.id = ttfv.ticket_id
LEFT JOIN users u ON ttfv.user_value = u.id
LEFT JOIN ticketing_field_status_options tfso ON ttfv.status_reference_value_uuid = tfso.id
GROUP BY tt.id;

-- Refresh every 5 minutes
REFRESH MATERIALIZED VIEW CONCURRENTLY matter_search_view;
```

**5. Application-Level Optimizations:**
- **Implement request coalescing** (multiple users searching same term)
- **Add search analytics** to identify slow queries
- **Implement search suggestions** (typeahead) with cached results
- **Rate limiting** to prevent search abuse

**Estimated Performance Improvements:**
- With Redis cache: 5-10ms response time (cache hits)
- With materialized views: 20-30ms (cache misses)
- With Elasticsearch: 10-20ms with advanced features

---

## Notes

- PostgreSQL pg_trgm extension is already installed and configured
- GIN indexes already created for text_value and string_value columns
- Frontend already has search parameter wired through useMatters hook
- Backend handler already accepts search parameter in Zod schema
- Sorting functionality will continue to work with search (independent JOINs)
