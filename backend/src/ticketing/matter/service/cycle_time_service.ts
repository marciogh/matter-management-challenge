import { config } from '../../../utils/config.js';
import { SLAStatus, CycleTime } from '../../types.js';
import pool from '../../../db/pool.js';

/**
 * Format milliseconds into human-readable duration string.
 * Pure function for easy unit testing.
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 60 * 1000) {
    return '< 1m';
  }

  const totalMinutes = Math.floor(durationMs / (60 * 1000));
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  const minutes = totalMinutes % 60;
  const hours = totalHours % 24;

  if (totalDays > 0) {
    return hours > 0 ? `${totalDays}d ${hours}h` : `${totalDays}d`;
  }

  if (totalHours > 0) {
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  return `${minutes}m`;
}

/**
 * Determine SLA status based on resolution time and completion state.
 * Pure function for easy unit testing.
 */
export function determineSLA(
  resolutionTimeMs: number | null,
  isCompleted: boolean,
  thresholdMs: number,
): SLAStatus {
  if (!isCompleted) {
    return 'In Progress';
  }

  if (resolutionTimeMs === null) {
    return 'In Progress';
  }

  return resolutionTimeMs <= thresholdMs ? 'Met' : 'Breached';
}

/**
 * Calculate resolution time between start and end timestamps.
 * Pure function for easy unit testing.
 */
export function calculateResolutionTime(
  startedAt: Date | null,
  completedAt: Date | null,
): number | null {
  if (!startedAt) {
    return null;
  }

  const endTime = completedAt ? completedAt.getTime() : Date.now();
  return endTime - startedAt.getTime();
}

/**
 * CycleTimeService - Calculate resolution times and SLA status for matters
 */
export class CycleTimeService {
  private _slaThresholdMs: number;

  constructor() {
    this._slaThresholdMs = config.SLA_THRESHOLD_HOURS * 60 * 60 * 1000;
  }

  async calculateCycleTimeAndSLA(
    ticketId: string,
    currentStatusGroupName: string | null,
  ): Promise<{ cycleTime: CycleTime; sla: SLAStatus }> {
    const { startedAt, completedAt } = await this._queryTransitions(ticketId);

    // No history - return N/A
    if (!startedAt) {
      return {
        cycleTime: {
          resolutionTimeMs: null,
          resolutionTimeFormatted: 'N/A',
          isInProgress: false,
          startedAt: null,
          completedAt: null,
        },
        sla: 'In Progress',
      };
    }

    const isCompleted = currentStatusGroupName === 'Done';
    const resolutionTimeMs = calculateResolutionTime(startedAt, isCompleted ? completedAt : null);
    const sla = determineSLA(resolutionTimeMs, isCompleted, this._slaThresholdMs);
    const resolutionTimeFormatted = resolutionTimeMs !== null
      ? formatDuration(resolutionTimeMs)
      : 'N/A';

    return {
      cycleTime: {
        resolutionTimeMs,
        resolutionTimeFormatted,
        isInProgress: !isCompleted,
        startedAt,
        completedAt: isCompleted ? completedAt : null,
      },
      sla,
    };
  }

  /**
   * Query cycle time history to get start and completion timestamps.
   * Uses PostgreSQL FILTER clause for efficient single-query extraction.
   */
  private async _queryTransitions(
    ticketId: string,
  ): Promise<{ startedAt: Date | null; completedAt: Date | null }> {
    const query = `
      SELECT
        MIN(tcth.transitioned_at) AS started_at,
        MIN(tcth.transitioned_at) FILTER (WHERE tfsg.name = 'Done') AS completed_at
      FROM ticketing_cycle_time_histories tcth
      JOIN ticketing_field_status_options tfso ON tcth.to_status_id = tfso.id
      JOIN ticketing_field_status_groups tfsg ON tfso.group_id = tfsg.id
      WHERE tcth.ticket_id = $1
    `;

    const result = await pool.query(query, [ticketId]);

    if (result.rows.length === 0 || !result.rows[0].started_at) {
      return { startedAt: null, completedAt: null };
    }

    return {
      startedAt: new Date(result.rows[0].started_at),
      completedAt: result.rows[0].completed_at ? new Date(result.rows[0].completed_at) : null,
    };
  }
}

export default CycleTimeService;
