export const defaultColumns = ['Бэклог', 'В работе', 'Готово'] as const;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
import crypto from 'node:crypto';

export function parseDateInput(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number),
      parsed = new Date(Date.UTC(year!, month! - 1, day!, 23, 59, 59));
    return parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day
      ? parsed
      : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}
