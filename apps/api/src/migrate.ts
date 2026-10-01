import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { pool } from './db/client.js';

const migrationDirectory = fileURLToPath(
  new URL('../drizzle/', import.meta.url),
);
const advisoryLockName = 'minimal-kanban:migrations';

type Migration = { name: string; sql: string; checksum: string };
export type MigrationAction = 'apply' | 'backfill' | 'skip';

export function migrationChecksum(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

export function migrationAction(
  name: string,
  storedChecksum: string | null | undefined,
  checksum: string,
): MigrationAction {
  if (storedChecksum === undefined) return 'apply';
  if (storedChecksum === null) return 'backfill';
  if (storedChecksum === checksum) return 'skip';
  throw new Error(
    `Migration checksum mismatch for ${name}; applied migrations must not be edited`,
  );
}

async function migrations(): Promise<Migration[]> {
  const names = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${migrationDirectory}/${name}`, 'utf8');
      return { name, sql, checksum: migrationChecksum(sql) };
    }),
  );
}

export async function runMigrations(migrationPool: Pool = pool) {
  const client = await migrationPool.connect();
  let locked = false;
  let failure: unknown;

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [
      advisoryLockName,
    ]);
    locked = true;
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await client.query(
      'ALTER TABLE _migrations ADD COLUMN IF NOT EXISTS checksum text',
    );

    for (const migration of await migrations()) {
      const existing = await client.query<{ checksum: string | null }>(
        'SELECT checksum FROM _migrations WHERE name = $1',
        [migration.name],
      );
      const action = migrationAction(
        migration.name,
        existing.rows[0]?.checksum,
        migration.checksum,
      );
      if (action === 'skip') continue;
      if (action === 'backfill') {
        await client.query(
          'UPDATE _migrations SET checksum = $2 WHERE name = $1 AND checksum IS NULL',
          [migration.name, migration.checksum],
        );
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO _migrations(name, checksum) VALUES($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (locked)
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
          advisoryLockName,
        ]);
    } catch (unlockError) {
      if (!failure) throw unlockError;
    } finally {
      client.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runMigrations();
  } finally {
    await pool.end();
  }
}
