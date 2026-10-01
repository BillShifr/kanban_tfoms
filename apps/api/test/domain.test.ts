import { describe, expect, it } from 'vitest';
import {
  defaultColumns,
  normalizeEmail,
  parseDateInput,
} from '../src/domain.js';

describe('first-slice domain invariants', () => {
  it('normalizes email consistently', () =>
    expect(normalizeEmail(' Admin@Example.COM ')).toBe('admin@example.com'));
  it('defines the compact default workflow in order', () =>
    expect(defaultColumns).toEqual(['Бэклог', 'В работе', 'Готово']));
  it('rejects impossible or timezone-less dates', () => {
    expect(parseDateInput('2026-02-29')).toBeNull();
    expect(parseDateInput('2026-01-01T10:00:00')).toBeNull();
    expect(parseDateInput('not-a-date')).toBeNull();
  });
  it('treats a date-only deadline as the end of its UTC day', () => {
    expect(parseDateInput('2026-09-30')?.toISOString()).toBe(
      '2026-09-30T23:59:59.000Z',
    );
  });
});
