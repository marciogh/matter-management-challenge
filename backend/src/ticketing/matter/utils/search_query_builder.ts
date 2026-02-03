import { PoolClient } from 'pg';

export interface SearchQueryResult {
  searchCondition: string;
  searchParams: string[];
  searchJoins: string;
}

/**
 * Build search WHERE conditions and JOINs for all field types using multi-token OR logic
 *
 * Strategy: Tokenize search term by whitespace, search each token across ALL field types,
 * combine with OR logic (match ANY token in ANY field)
 *
 * Example: "Smith 500" → ["Smith", "500"]
 * - Finds matters with "Smith" in ANY field (name, subject, case number, etc.)
 * - OR finds matters with "500" in ANY field (numbers, text, currency, etc.)
 *
 * @param searchTerm - User's search input
 * @param client - Database client (unused but kept for API consistency)
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

  // Tokenize search term by whitespace
  const tokens = searchTerm.trim().split(/\s+/);
  const params: string[] = [];
  let paramIndex = startParamIndex;

  // Build search conditions for each token (OR logic - match ANY token in ANY field)
  const tokenConditions = tokens.map((token) => {
    const searchPattern = `%${token}%`;
    params.push(searchPattern);

    const conditions: string[] = [];
    const currentParam = `$${paramIndex}`;
    paramIndex++;

    // Search this token in ALL field types
    conditions.push(`ttfv_search.text_value ILIKE ${currentParam}`);
    conditions.push(`ttfv_search.string_value ILIKE ${currentParam}`);
    conditions.push(`CAST(ttfv_search.number_value AS TEXT) ILIKE ${currentParam}`);
    conditions.push(`TO_CHAR(ttfv_search.date_value, 'YYYY-MM-DD') ILIKE ${currentParam}`);
    conditions.push(`CAST((ttfv_search.currency_value->>'amount') AS TEXT) ILIKE ${currentParam}`);
    conditions.push(`CONCAT(u_search.first_name, ' ', u_search.last_name) ILIKE ${currentParam}`);
    conditions.push(`tfo_search.label ILIKE ${currentParam}`);
    conditions.push(`tfso_search.label ILIKE ${currentParam}`);

    // Boolean: match if token contains 'true', 'yes', 'false', 'no'
    const lowerToken = token.toLowerCase();
    if (lowerToken.includes('true') || lowerToken.includes('yes') || lowerToken.includes('✓')) {
      conditions.push(`ttfv_search.boolean_value = true`);
    }
    if (lowerToken.includes('false') || lowerToken.includes('no') || lowerToken.includes('✗')) {
      conditions.push(`ttfv_search.boolean_value = false`);
    }

    return `(${conditions.join(' OR ')})`;
  });

  // Combine all token conditions with OR (match ANY token)
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
          ${tokenConditions.join('\n          OR ')}
        )
    )
  `;

  return {
    searchCondition,
    searchParams: params,
    searchJoins: '', // Using EXISTS subquery, so no main query joins needed
  };
}
