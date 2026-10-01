import crypto from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { pool as modulePool } from '../src/db/client.js';
import { runMigrations } from '../src/migrate.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const database = describe.skipIf(!databaseUrl);

database('PostgreSQL invariants', () => {
  const testPool = new Pool({ connectionString: databaseUrl });
  let client: PoolClient;
  let userA: string;
  let userB: string;
  let departmentA: string;
  let boardA: string;
  let boardB: string;
  let columnA: string;
  let columnB: string;

  beforeAll(async () => {
    await runMigrations(testPool);
    await runMigrations(testPool);
  });

  beforeEach(async () => {
    client = await testPool.connect();
    await client.query('BEGIN');
    [userA, userB, departmentA, boardA, boardB, columnA, columnB] = Array.from(
      { length: 7 },
      () => crypto.randomUUID(),
    );
    await client.query(
      `insert into users(id,email,password_hash,role)
       values ($1,$2,'hash','admin'),($3,$4,'hash','user')`,
      [userA, `${userA}@example.test`, userB, `${userB}@example.test`],
    );
    await client.query(`insert into departments(id,name) values ($1,$2)`, [
      departmentA,
      `Department ${departmentA}`,
    ]);
    await client.query(
      `insert into boards(id,name,department_id,created_by)
       values ($1,'A',$2,$3),($4,'B',$2,$5)`,
      [boardA, departmentA, userA, boardB, userB],
    );
    await client.query(
      `insert into board_members(board_id,user_id,role)
       values ($1,$2,'admin'),($3,$4,'admin')`,
      [boardA, userA, boardB, userB],
    );
    await client.query(
      `insert into columns(id,board_id,name,position)
       values ($1,$2,'A',1),($3,$4,'B',1)`,
      [columnA, boardA, columnB, boardB],
    );
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  afterAll(async () => {
    await testPool.end();
    await modulePool.end();
  });

  it('keeps migrations idempotent and checksummed', async () => {
    const result = await client.query<{ count: string }>(
      'select count(*)::text as count from _migrations where checksum is not null',
    );
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(10);
  });

  it('uses only admin and user account roles and defaults to user', async () => {
    const roles = await client.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       where pg_type.typname = 'user_role'
       order by enumsortorder`,
    );
    expect(roles.rows.map((row) => row.enumlabel)).toEqual(['admin', 'user']);

    const defaultUserId = crypto.randomUUID();
    const created = await client.query<{ role: string }>(
      `insert into users(id,email,password_hash)
       values ($1,$2,'hash')
       returning role::text`,
      [defaultUserId, `${defaultUserId}@example.test`],
    );
    expect(created.rows[0]?.role).toBe('user');
  });

  it('rejects a task whose column belongs to another board', async () => {
    await expect(
      client.query(
        `insert into tasks(id,board_id,column_id,title,author_id,position)
         values ($1,$2,$3,'invalid',$4,1)`,
        [crypto.randomUUID(), boardA, columnB, userA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a task author who is not a board member', async () => {
    await expect(
      client.query(
        `insert into tasks(id,board_id,column_id,title,author_id,position)
         values ($1,$2,$3,'invalid',$4,1)`,
        [crypto.randomUUID(), boardA, columnA, userB],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a board whose department does not exist', async () => {
    await expect(
      client.query(
        `insert into boards(id,name,department_id,created_by)
         values ($1,'invalid',$2,$3)`,
        [crypto.randomUUID(), crypto.randomUUID(), userA],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects simultaneous user and typed-name assignees', async () => {
    await expect(
      client.query(
        `insert into tasks(
           id,board_id,column_id,title,author_id,assignee_id,assignee_name,position
         ) values ($1,$2,$3,'invalid',$4,$4,'Typed name',1)`,
        [crypto.randomUUID(), boardA, columnA, userA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects control and bidi characters in typed assignee names', async () => {
    await expect(
      client.query(
        `insert into tasks(
           id,board_id,column_id,title,author_id,assignee_name,position
         ) values ($1,$2,$3,'invalid',$4,$5,1)`,
        [crypto.randomUUID(), boardA, columnA, userA, 'Unsafe\u202ename'],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('stores a typed assignee and its assignment history', async () => {
    const taskId = crypto.randomUUID();
    await client.query(
      `insert into tasks(
         id,board_id,column_id,title,author_id,assignee_name,position
       ) values ($1,$2,$3,'valid',$4,'External person',1)`,
      [taskId, boardA, columnA, userA],
    );
    await client.query(
      `insert into task_events(
         id,task_id,actor_id,type,from_assignee_name
       ) values ($1,$2,$3,'assignee_changed','External person')`,
      [crypto.randomUUID(), taskId, userA],
    );

    const result = await client.query<{
      assignee_id: string | null;
      assignee_name: string | null;
    }>(`select assignee_id,assignee_name from tasks where id=$1`, [taskId]);
    expect(result.rows[0]).toEqual({
      assignee_id: null,
      assignee_name: 'External person',
    });
  });
});
