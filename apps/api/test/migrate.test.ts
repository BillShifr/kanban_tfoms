import { describe, expect, it } from 'vitest';
import { migrationAction, migrationChecksum } from '../src/migrate.js';

describe('migration checksum decisions', () => {
  it('hashes migration bytes deterministically', () => {
    expect(migrationChecksum('SELECT 1;\n')).toBe(
      migrationChecksum('SELECT 1;\n'),
    );
    expect(migrationChecksum('SELECT 1;\n')).not.toBe(
      migrationChecksum('SELECT 2;\n'),
    );
  });

  it('applies new migrations and backfills legacy migration rows', () => {
    expect(migrationAction('0007.sql', undefined, 'hash')).toBe('apply');
    expect(migrationAction('0007.sql', null, 'hash')).toBe('backfill');
    expect(migrationAction('0007.sql', 'hash', 'hash')).toBe('skip');
  });

  it('refuses to run an edited applied migration', () => {
    expect(() => migrationAction('0007.sql', 'old', 'new')).toThrow(
      'Migration checksum mismatch for 0007.sql',
    );
  });
});
