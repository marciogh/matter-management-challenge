import { SortFieldConfig } from './sort_field_mapper.js';

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

    case 'computed_sla': {
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
    }

    default:
      return { joinClause: '', orderByClause: 'tt.created_at DESC' };
  }
}
