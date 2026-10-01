import { describe, expect, it } from 'vitest';
import {
  defaultColumns,
  normalizeEmail,
  parseDateInput,
} from '../src/domain.js';
import {
  canChangeAccountRole,
  canManageAccount,
  isElevated,
} from '../src/policy.js';

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

describe('role policy', () => {
  it('keeps global access and account-management boundaries explicit', () => {
    expect(isElevated('admin')).toBe(true);
    expect(isElevated('user')).toBe(false);
    expect(canManageAccount('admin', 'user')).toBe(true);
    expect(canManageAccount('admin', 'admin')).toBe(false);
    expect(canManageAccount('admin', 'superadmin')).toBe(false);
    expect(canManageAccount('superadmin', 'admin')).toBe(true);
    expect(canManageAccount('superadmin', 'superadmin')).toBe(true);
    expect(canChangeAccountRole('admin')).toBe(false);
    expect(canChangeAccountRole('superadmin')).toBe(true);
  });
});
