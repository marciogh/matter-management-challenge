import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDuration,
  determineSLA,
  calculateResolutionTime,
} from '../service/cycle_time_service.js';

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(45 * 60 * 1000)).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe('2h 30m');
  });

  it('formats hours only when no remaining minutes', () => {
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe('3h');
  });

  it('formats days and hours', () => {
    expect(formatDuration(3 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000)).toBe('3d 5h');
  });

  it('formats days only when no remaining hours', () => {
    expect(formatDuration(2 * 24 * 60 * 60 * 1000)).toBe('2d');
  });

  it('handles less than 1 minute', () => {
    expect(formatDuration(30 * 1000)).toBe('< 1m');
  });

  it('handles zero duration', () => {
    expect(formatDuration(0)).toBe('< 1m');
  });

  it('handles exactly 1 minute', () => {
    expect(formatDuration(60 * 1000)).toBe('1m');
  });

  it('handles exactly 1 hour', () => {
    expect(formatDuration(60 * 60 * 1000)).toBe('1h');
  });

  it('handles exactly 1 day', () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d');
  });
});

describe('determineSLA', () => {
  const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

  it('returns "In Progress" when not completed', () => {
    expect(determineSLA(5 * 60 * 60 * 1000, false, EIGHT_HOURS_MS)).toBe('In Progress');
  });

  it('returns "In Progress" when resolution time is null and not completed', () => {
    expect(determineSLA(null, false, EIGHT_HOURS_MS)).toBe('In Progress');
  });

  it('returns "In Progress" when resolution time is null and completed', () => {
    expect(determineSLA(null, true, EIGHT_HOURS_MS)).toBe('In Progress');
  });

  it('returns "Met" when resolved within threshold', () => {
    expect(determineSLA(7 * 60 * 60 * 1000, true, EIGHT_HOURS_MS)).toBe('Met');
  });

  it('returns "Met" when resolved exactly at threshold', () => {
    expect(determineSLA(EIGHT_HOURS_MS, true, EIGHT_HOURS_MS)).toBe('Met');
  });

  it('returns "Breached" when resolved over threshold', () => {
    expect(determineSLA(9 * 60 * 60 * 1000, true, EIGHT_HOURS_MS)).toBe('Breached');
  });

  it('returns "Breached" when resolved just over threshold', () => {
    expect(determineSLA(EIGHT_HOURS_MS + 1, true, EIGHT_HOURS_MS)).toBe('Breached');
  });

  it('returns "Met" when resolved in 0ms', () => {
    expect(determineSLA(0, true, EIGHT_HOURS_MS)).toBe('Met');
  });
});

describe('calculateResolutionTime', () => {
  it('returns null when no start time', () => {
    expect(calculateResolutionTime(null, null)).toBeNull();
  });

  it('returns null when start time is null even with end time', () => {
    expect(calculateResolutionTime(null, new Date())).toBeNull();
  });

  it('calculates time between start and completion', () => {
    const start = new Date('2025-01-01T10:00:00Z');
    const end = new Date('2025-01-01T12:30:00Z');
    expect(calculateResolutionTime(start, end)).toBe(2.5 * 60 * 60 * 1000);
  });

  it('calculates exact duration for specific timestamps', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-01T08:00:00Z');
    expect(calculateResolutionTime(start, end)).toBe(8 * 60 * 60 * 1000);
  });

  describe('ongoing time calculation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calculates ongoing time when not completed', () => {
      const now = new Date('2025-01-01T15:00:00Z');
      vi.setSystemTime(now);

      const start = new Date('2025-01-01T12:00:00Z'); // 3 hours ago
      const result = calculateResolutionTime(start, null);

      expect(result).toBe(3 * 60 * 60 * 1000);
    });
  });
});
