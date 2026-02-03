import pool from '../../../db/pool.js';
import { Matter, MatterListParams, FieldValue, UserValue, CurrencyValue, StatusValue } from '../../types.js';
import logger from '../../../utils/logger.js';
import { PoolClient } from 'pg';
import { getSortFieldConfig } from '../utils/sort_field_mapper.js';
import { buildSortQuery } from '../utils/sort_query_builder.js';
import { getFieldIdByName } from '../utils/field_id_resolver.js';

export class MatterRepo {
  /**
   * Get paginated list of matters with search and sorting
   * 
   * TODO: Implement search functionality
   * - Search across text, number, and other field types
   * - Use PostgreSQL pg_trgm extension for fuzzy matching
   * - Consider performance with proper indexing
   * - Support searching cycle times and SLA statuses
   * 
   * Search Requirements:
   * - Text fields: Use ILIKE with pg_trgm indexes
   * - Number fields: Convert to text for search
   * - Status fields: Search by label
   * - User fields: Search by name
   * - Consider debouncing on frontend (already implemented)
   * 
   * Performance Considerations for 10× Load:
   * - Add GIN indexes on searchable columns
   * - Consider Elasticsearch for advanced search at scale
   * - Implement query result caching
   * - Use connection pooling effectively
   */
  async getMatters(params: MatterListParams) {
    const { page = 1, limit = 25, sortBy = 'created_at', sortOrder = 'desc' } = params;
    const offset = (page - 1) * limit;

    const client = await pool.connect();

    try {
      // TODO: Implement search condition
      // Currently search is not implemented - add ILIKE queries with pg_trgm
      const searchCondition = '';
      const queryParams: (string | number)[] = [];
      const paramIndex = 1;

      // Determine sort column and build dynamic JOIN/ORDER BY
      let sortJoinClause = '';
      let orderByClause = 'tt.created_at DESC';

      const sortConfig = getSortFieldConfig(sortBy);
      if (sortConfig) {
        let fieldId: string | undefined;
        if (sortConfig.fieldName) {
          fieldId = (await getFieldIdByName(sortConfig.fieldName)) ?? undefined;
        }
        const sortQuery = buildSortQuery(sortConfig, sortOrder, fieldId);
        sortJoinClause = sortQuery.joinClause;
        orderByClause = sortQuery.orderByClause;
      }

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ticketing_ticket tt
        WHERE 1=1 ${searchCondition}
      `;
      
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // Get matters
      const mattersQuery = `
        SELECT tt.id, tt.board_id, tt.created_at, tt.updated_at
        FROM ticketing_ticket tt
        ${sortJoinClause}
        WHERE 1=1 ${searchCondition}
        ORDER BY ${orderByClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      queryParams.push(limit, offset);
      const mattersResult = await client.query(mattersQuery, queryParams);

      // Get all fields for these matters
      const matters: Matter[] = [];

      for (const matterRow of mattersResult.rows) {
        const fields = await this.getMatterFields(client, matterRow.id);
        
        matters.push({
          id: matterRow.id,
          boardId: matterRow.board_id,
          fields,
          createdAt: matterRow.created_at,
          updatedAt: matterRow.updated_at,
        });
      }

      return { matters, total };
    } finally {
      client.release();
    }
  }

  /**
   * Get a single matter by ID
   */
  async getMatterById(matterId: string): Promise<Matter | null> {
    const client = await pool.connect();

    try {
      const matterResult = await client.query(
        `SELECT id, board_id, created_at, updated_at
         FROM ticketing_ticket
         WHERE id = $1`,
        [matterId],
      );

      if (matterResult.rows.length === 0) {
        return null;
      }

      const matterRow = matterResult.rows[0];
      const fields = await this.getMatterFields(client, matterId);

      return {
        id: matterRow.id,
        boardId: matterRow.board_id,
        fields,
        createdAt: matterRow.created_at,
        updatedAt: matterRow.updated_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get all field values for a matter
   */
  private async getMatterFields(client: PoolClient, ticketId: string): Promise<Record<string, FieldValue>> {
    const fieldsResult = await client.query(
      `SELECT 
        ttfv.id,
        ttfv.ticket_field_id,
        tf.name as field_name,
        tf.field_type,
        ttfv.text_value,
        ttfv.string_value,
        ttfv.number_value,
        ttfv.date_value,
        ttfv.boolean_value,
        ttfv.currency_value,
        ttfv.user_value,
        ttfv.select_reference_value_uuid,
        ttfv.status_reference_value_uuid,
        -- User data
        u.id as user_id,
        u.email as user_email,
        u.first_name as user_first_name,
        u.last_name as user_last_name,
        -- Select option label
        tfo.label as select_option_label,
        -- Status option data
        tfso.label as status_option_label,
        tfsg.name as status_group_name
       FROM ticketing_ticket_field_value ttfv
       JOIN ticketing_fields tf ON ttfv.ticket_field_id = tf.id
       LEFT JOIN users u ON ttfv.user_value = u.id
       LEFT JOIN ticketing_field_options tfo ON ttfv.select_reference_value_uuid = tfo.id
       LEFT JOIN ticketing_field_status_options tfso ON ttfv.status_reference_value_uuid = tfso.id
       LEFT JOIN ticketing_field_status_groups tfsg ON tfso.group_id = tfsg.id
       WHERE ttfv.ticket_id = $1`,
      [ticketId],
    );

    const fields: Record<string, FieldValue> = {};

    for (const row of fieldsResult.rows) {
      let value: string | number | boolean | Date | CurrencyValue | UserValue | StatusValue | null = null;
      let displayValue: string | undefined = undefined;

      switch (row.field_type) {
        case 'text':
          value = row.text_value || row.string_value;
          break;
        case 'number':
          value = row.number_value ? parseFloat(row.number_value) : null;
          displayValue = value !== null ? value.toLocaleString() : undefined;
          break;
        case 'date':
          value = row.date_value;
          displayValue = row.date_value ? new Date(row.date_value).toLocaleDateString() : undefined;
          break;
        case 'boolean':
          value = row.boolean_value;
          displayValue = value ? '✓' : '✗';
          break;
        case 'currency':
          value = row.currency_value as CurrencyValue;
          if (row.currency_value) {
            displayValue = `${(row.currency_value as CurrencyValue).amount.toLocaleString()} ${(row.currency_value as CurrencyValue).currency}`;
          }
          break;
        case 'user':
          if (row.user_id) {
            const userValue: UserValue = {
              id: row.user_id,
              email: row.user_email,
              firstName: row.user_first_name,
              lastName: row.user_last_name,
              displayName: `${row.user_first_name} ${row.user_last_name}`,
            };
            value = userValue;
            displayValue = userValue.displayName;
          }
          break;
        case 'select':
          value = row.select_reference_value_uuid;
          displayValue = row.select_option_label;
          break;
        case 'status':
          value = row.status_reference_value_uuid;
          displayValue = row.status_option_label;
          // Store group name in metadata for SLA calculations
          if (row.status_group_name) {
            value = {
              statusId: row.status_reference_value_uuid,
              groupName: row.status_group_name,
            } as StatusValue;
          }
          break;
      }

      fields[row.field_name] = {
        fieldId: row.ticket_field_id,
        fieldName: row.field_name,
        fieldType: row.field_type,
        value,
        displayValue,
      };
    }

    return fields;
  }

  /**
   * Update a matter's field value
   */
  async updateMatterField(
    matterId: string,
    fieldId: string,
    fieldType: string,
    value: string | number | boolean | Date | CurrencyValue | UserValue | StatusValue | null,
    userId: number,
  ): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Determine which column to update based on field type
      let columnName: string;
      let columnValue: string | number | boolean | Date | null = null;

      switch (fieldType) {
        case 'text':
          columnName = 'text_value';
          columnValue = value as string;
          break;
        case 'number':
          columnName = 'number_value';
          columnValue = value as number;
          break;
        case 'date':
          columnName = 'date_value';
          columnValue = value as Date;
          break;
        case 'boolean':
          columnName = 'boolean_value';
          columnValue = value as boolean;
          break;
        case 'currency':
          columnName = 'currency_value';
          columnValue = JSON.stringify(value);
          break;
        case 'user':
          columnName = 'user_value';
          columnValue = value as number;
          break;
        case 'select':
          columnName = 'select_reference_value_uuid';
          columnValue = value as string;
          break;
        case 'status': {
          columnName = 'status_reference_value_uuid';
          columnValue = value as string;
          
          // Track status change in cycle time history
          const currentStatusResult = await client.query(
            `SELECT status_reference_value_uuid 
             FROM ticketing_ticket_field_value 
             WHERE ticket_id = $1 AND ticket_field_id = $2`,
            [matterId, fieldId],
          );
          
          if (currentStatusResult.rows.length > 0) {
            const fromStatusId = currentStatusResult.rows[0].status_reference_value_uuid;
            
            await client.query(
              `INSERT INTO ticketing_cycle_time_histories 
               (ticket_id, status_field_id, from_status_id, to_status_id, transitioned_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              [matterId, fieldId, fromStatusId, value],
            );
          }
          break;
        }
        default:
          throw new Error(`Unsupported field type: ${fieldType}`);
      }

      // Upsert field value
      await client.query(
        `INSERT INTO ticketing_ticket_field_value 
         (ticket_id, ticket_field_id, ${columnName}, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ticket_id, ticket_field_id)
         DO UPDATE SET ${columnName} = $3, updated_by = $5, updated_at = NOW()`,
        [matterId, fieldId, columnValue, userId, userId],
      );

      // Update matter's updated_at
      await client.query(
        `UPDATE ticketing_ticket SET updated_at = NOW() WHERE id = $1`,
        [matterId],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating matter field', { error, matterId, fieldId });
      throw error;
    } finally {
      client.release();
    }
  }
}

export default MatterRepo;

