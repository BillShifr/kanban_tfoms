import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
import { migrationChecksum, runMigrations } from '../src/migrate.js';

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
       values ($1,$2,'hash','superadmin'),($3,$4,'hash','user')`,
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
       values ($1,$2,'member')`,
      [boardB, userB],
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
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(15);
  });

  it('does not block a task on another reward grant and reconciles afterward', async () => {
    const competing = await testPool.connect();
    try {
      await competing.query('begin');
      await competing.query(
        "select pg_advisory_xact_lock(hashtextextended('achievement:' || $1,0))",
        [userA],
      );
      await client.query("set local statement_timeout='2s'");
      await client.query(
        "insert into tasks(id,board_id,column_id,title,author_id,position) values($1,$2,$3,'Concurrent reward',$4,1)",
        [crypto.randomUUID(), boardA, columnA, userA],
      );
      expect(
        (
          await client.query(
            'select * from earned_achievements where user_id=$1',
            [userA],
          )
        ).rowCount,
      ).toBe(0);
      await competing.query('commit');
      await client.query('select grant_achievements($1)', [userA]);
      expect(
        (
          await client.query(
            'select code from earned_achievements where user_id=$1',
            [userA],
          )
        ).rows,
      ).toEqual([{ code: 'initiative' }]);
    } finally {
      await competing.query('rollback');
      competing.release();
    }
  });

  it.each(['0014_', '0015_', '0016_', '0018_', '0020_'])(
    'upgrades a populated schema before %s without losing tasks',
    async (cutoff) => {
      const schema = `migration_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
      const migrationDirectory = fileURLToPath(
        new URL('../drizzle/', import.meta.url),
      );
      await testPool.query(`create schema "${schema}"`);
      const legacyPool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });

      try {
        const migrationNames = (await readdir(migrationDirectory))
          .filter((name) => name.endsWith('.sql') && name < cutoff)
          .sort();
        const legacyClient = await legacyPool.connect();
        try {
          await legacyClient.query(
            `create table _migrations (
            name text primary key,
            applied_at timestamptz not null default now(),
            checksum text
          )`,
          );
          for (const name of migrationNames) {
            const sql = await readFile(`${migrationDirectory}/${name}`, 'utf8');
            await legacyClient.query('begin');
            try {
              await legacyClient.query(sql);
              await legacyClient.query(
                'insert into _migrations(name, checksum) values ($1, $2)',
                [name, migrationChecksum(sql)],
              );
              await legacyClient.query('commit');
            } catch (error) {
              await legacyClient.query('rollback');
              throw error;
            }
          }

          const legacyUser = crypto.randomUUID();
          const legacyDepartment = crypto.randomUUID();
          const legacyBoard = crypto.randomUUID();
          const legacyColumn = crypto.randomUUID();
          const legacyTask = crypto.randomUUID();
          await legacyClient.query(
            `insert into users(id,email,password_hash,role)
           values ($1,$2,'hash','user')`,
            [legacyUser, `${legacyUser}@example.test`],
          );
          await legacyClient.query(
            'insert into departments(id,name) values ($1,$2)',
            [legacyDepartment, `Legacy ${legacyDepartment}`],
          );
          await legacyClient.query(
            `insert into boards(id,name,department_id,created_by)
           values ($1,'Legacy board',$2,$3)`,
            [legacyBoard, legacyDepartment, legacyUser],
          );
          await legacyClient.query(
            `insert into board_members(board_id,user_id,role)
           values ($1,$2,'admin')`,
            [legacyBoard, legacyUser],
          );
          await legacyClient.query(
            `insert into columns(id,board_id,name,position)
           values ($1,$2,'Legacy column',1)`,
            [legacyColumn, legacyBoard],
          );
          await legacyClient.query(
            `insert into tasks(
              id,board_id,column_id,title,author_id,assignee_id,position,created_at,completed_at
            ) values (
              $1,$2,$3,'Legacy task',$4,$4,1,
              '2026-09-10T08:00:00Z','2026-09-12T09:30:00Z'
            )`,
            [legacyTask, legacyBoard, legacyColumn, legacyUser],
          );
          if (cutoff === '0018_') {
            await legacyClient.query(
              `insert into task_comments(id,task_id,author_id,body) values ($1,$2,$3,'Историческое обсуждение')`,
              [crypto.randomUUID(), legacyTask, legacyUser],
            );
          }
        } finally {
          legacyClient.release();
        }

        await runMigrations(legacyPool);
        await runMigrations(legacyPool);

        const upgraded = await legacyPool.query<{ title: string }>(
          'select title from tasks where title = $1',
          ['Legacy task'],
        );
        expect(upgraded.rows).toEqual([{ title: 'Legacy task' }]);
        const contributions = await legacyPool.query<{
          kind: string;
          points: number;
          createdAt: Date;
        }>(
          `select kind,points,created_at as "createdAt"
           from contribution_events order by kind`,
        );
        expect(
          contributions.rows.map(({ kind, points }) => ({ kind, points })),
        ).toEqual([
          { kind: 'completed', points: 10 },
          { kind: 'created', points: 2 },
        ]);
        if (cutoff <= '0015_') {
          expect(
            contributions.rows.map(({ kind, createdAt }) => ({
              kind,
              createdAt: createdAt.toISOString(),
            })),
          ).toEqual([
            {
              kind: 'completed',
              createdAt: '2026-09-12T09:30:00.000Z',
            },
            { kind: 'created', createdAt: '2026-09-10T08:00:00.000Z' },
          ]);
        }
        expect(
          (await legacyPool.query('select * from user_profiles')).rows,
        ).toEqual([]);
        expect(
          (
            await legacyPool.query(
              'select code from earned_achievements order by code',
            )
          ).rows,
        ).toEqual([{ code: 'initiative' }, { code: 'result' }]);
        expect(
          (await legacyPool.query('select * from task_comment_unread')).rows,
        ).toEqual([]);
        if (cutoff === '0018_') {
          expect(
            (await legacyPool.query('select body from task_comments')).rows,
          ).toEqual([{ body: 'Историческое обсуждение' }]);
        }
        await legacyPool.query(
          `insert into task_comments(id,task_id,author_id,body)
         select $1,id,author_id,'Первый комментарий'
         from tasks where title = 'Legacy task'`,
          [crypto.randomUUID()],
        );
        await expect(
          legacyPool.query(
            `insert into task_comments(id,task_id,author_id,body)
           select $1,id,author_id,'   '
           from tasks where title = 'Legacy task'`,
            [crypto.randomUUID()],
          ),
        ).rejects.toThrow();
      } finally {
        await legacyPool.end();
        await testPool.query(`drop schema if exists "${schema}" cascade`);
      }
    },
  );

  it('notifies task recipients, excludes own comments and preserves concurrent unread messages', async () => {
    const task = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,assignee_id,position)
       values ($1,$2,$3,'Discussion',$4,$5,1)`,
      [task, boardB, columnB, userA, userB],
    );
    await client.query(
      `insert into task_comments(id,task_id,author_id,body) values ($1,$2,$3,'First'),($4,$2,$3,'Second')`,
      [first, task, userB, second],
    );
    expect(
      (
        await client.query(
          'select user_id from task_comment_unread where comment_id=$1',
          [first],
        )
      ).rows,
    ).toEqual([{ user_id: userA }]);
    await client.query(
      'delete from task_comment_unread where user_id=$1 and comment_id=$2',
      [userA, first],
    );
    expect(
      (
        await client.query(
          'select comment_id from task_comment_unread where user_id=$1',
          [userA],
        )
      ).rows,
    ).toEqual([{ comment_id: second }]);
    await client.query('delete from tasks where id=$1', [task]);
    expect(
      (
        await client.query(
          'select * from task_comment_unread where user_id=$1',
          [userA],
        )
      ).rows,
    ).toEqual([]);
  });

  it('freezes tied season awards and keeps earned frames after tasks are deleted', async () => {
    const taskA = crypto.randomUUID(),
      taskB = crypto.randomUUID();
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,assignee_id,completed_at,position)
       values($1,$2,$3,'Reward A',$4,$4,now(),1),($5,$6,$7,'Reward B',$8,$8,now(),1)`,
      [taskA, boardA, columnA, userA, taskB, boardB, columnB, userB],
    );
    await client.query(
      "update contribution_events set created_at='2000-01-10T00:00:00Z' where task_id in ($1,$2)",
      [taskA, taskB],
    );
    await client.query("update reward_clock set next_period='2000-01-01'");
    await client.query(
      "select finalize_reward_seasons('2000-02-01T00:00:00Z')",
    );
    await client.query(
      "select finalize_reward_seasons('2000-02-01T00:00:00Z')",
    );
    const awards = await client.query(
      "select place,points,completed from monthly_rewards where period='2000-01-01' and user_id in ($1,$2)",
      [userA, userB],
    );
    expect(awards.rows).toEqual([
      { place: 1, points: 12, completed: 1 },
      { place: 1, points: 12, completed: 1 },
    ]);
    // Avoid advancing synthetic test seasons through the actual present.
    await client.query(
      "update reward_clock set next_period=date_trunc('month',now() at time zone 'UTC')::date",
    );
    await client.query('delete from tasks where id in ($1,$2)', [taskA, taskB]);
    expect(
      (
        await client.query(
          'select code from earned_achievements where user_id=$1 order by code',
          [userA],
        )
      ).rows,
    ).toEqual([{ code: 'initiative' }, { code: 'result' }]);
    expect(
      (
        await client.query(
          "select * from monthly_rewards where period='2000-01-01' and user_id in ($1,$2)",
          [userA, userB],
        )
      ).rowCount,
    ).toBe(2);
    expect(
      (
        await client.query(
          'select * from contribution_events where task_id=$1',
          [taskA],
        )
      ).rowCount,
    ).toBe(0);
  });

  it('finalizes before deletion and excludes creation-only contributors from seasonal prizes', async () => {
    const taskA = crypto.randomUUID(),
      taskB = crypto.randomUUID();
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,assignee_id,completed_at,position)
       values($1,$2,$3,'Completed',$4,$4,now(),1),($5,$6,$7,'Created only',$8,null,null,1)`,
      [taskA, boardA, columnA, userA, taskB, boardB, columnB, userB],
    );
    await client.query(
      "update contribution_events set created_at=(date_trunc('month',now() at time zone 'UTC')-interval '1 month') at time zone 'UTC' where task_id in ($1,$2)",
      [taskA, taskB],
    );
    await client.query(
      "update reward_clock set next_period=(date_trunc('month',now() at time zone 'UTC')-interval '1 month')::date",
    );
    await client.query('delete from tasks where id=$1', [taskA]);
    expect(
      (
        await client.query(
          'select completed from monthly_rewards where user_id=$1',
          [userA],
        )
      ).rows,
    ).toEqual([{ completed: 1 }]);
    expect(
      (
        await client.query('select * from monthly_rewards where user_id=$1', [
          userB,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('uses scoped manager alongside global roles and defaults to user', async () => {
    const roles = await client.query<{ enumlabel: string }>(
      `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       where pg_type.typname = 'user_role'
       order by enumsortorder`,
    );
    expect(roles.rows.map((row) => row.enumlabel)).toEqual([
      'superadmin',
      'admin',
      'manager',
      'user',
    ]);

    const defaultUserId = crypto.randomUUID();
    const created = await client.query<{ role: string }>(
      `insert into users(id,email,password_hash)
       values ($1,$2,'hash')
       returning role::text`,
      [defaultUserId, `${defaultUserId}@example.test`],
    );
    expect(created.rows[0]?.role).toBe('user');
  });

  it('enforces responsibility group roles and active membership', async () => {
    const managerId = crypto.randomUUID(),
      adminId = crypto.randomUUID(),
      groupId = crypto.randomUUID(),
      invalidGroupId = crypto.randomUUID(),
      groupDepartmentId = crypto.randomUUID();
    const expectConstraint = async (
      statement: string,
      values: unknown[],
      code = '23514',
    ) => {
      await client.query('savepoint responsibility_constraint');
      try {
        await client.query(statement, values);
        throw new Error('Expected responsibility constraint to reject write');
      } catch (error) {
        expect(error).toMatchObject({ code });
      } finally {
        await client.query('rollback to savepoint responsibility_constraint');
        await client.query('release savepoint responsibility_constraint');
      }
    };
    await client.query(
      `insert into users(id,email,password_hash,role)
       values ($1,$2,'hash','manager'),($3,$4,'hash','admin')`,
      [
        managerId,
        `${managerId}@example.test`,
        adminId,
        `${adminId}@example.test`,
      ],
    );
    await client.query(`insert into departments(id,name) values ($1,$2)`, [
      groupDepartmentId,
      `Group ${groupDepartmentId}`,
    ]);
    await client.query(
      `insert into responsibility_groups(id,name,department_id,responsible_id)
       values ($1,'Support',$2,$3)`,
      [groupId, groupDepartmentId, managerId],
    );
    await client.query(
      `insert into responsibility_group_members(group_id,user_id)
       values ($1,$2)`,
      [groupId, adminId],
    );
    await client.query(
      `insert into department_members(department_id,user_id) values ($1,$2)`,
      [groupDepartmentId, managerId],
    );

    await expectConstraint(`update users set role='user' where id=$1`, [
      managerId,
    ]);
    await expectConstraint(`update users set archived_at=now() where id=$1`, [
      managerId,
    ]);
    await expectConstraint(
      `insert into responsibility_group_members(group_id,user_id)
       values ($1,$2)`,
      [groupId, userA],
    );
    await expectConstraint(
      `insert into responsibility_groups(id,name,department_id,responsible_id)
       values ($1,'Invalid',$2,$3)`,
      [invalidGroupId, groupDepartmentId, userB],
    );
    await expectConstraint(
      `delete from departments where id=$1`,
      [groupDepartmentId],
      '23503',
    );

    await client.query(`delete from responsibility_groups where id=$1`, [
      groupId,
    ]);
    await client.query(`update users set role='user' where id=$1`, [managerId]);
    expect(
      (
        await client.query<{ role: string }>(
          'select role::text as role from users where id=$1',
          [managerId],
        )
      ).rows[0]?.role,
    ).toBe('user');
  });

  it('allows legacy accounts without names and validates supplied names', async () => {
    const legacy = await client.query<{
      first_name: string | null;
      last_name: string | null;
    }>(`select first_name, last_name from users where id=$1`, [userA]);
    expect(legacy.rows[0]).toEqual({ first_name: null, last_name: null });

    await client.query(
      `update users set first_name=$2, last_name=$3 where id=$1`,
      [userA, 'Иван', 'Петров'],
    );
    await expect(
      client.query(`update users set first_name=' Имя' where id=$1`, [userA]),
    ).rejects.toMatchObject({ code: '23514' });
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

  it('accepts department access and prevents scoped access for elevated accounts', async () => {
    await client.query(
      `insert into department_members(department_id,user_id) values ($1,$2)`,
      [departmentA, userB],
    );
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,position)
       values ($1,$2,$3,'department access',$4,1)`,
      [crypto.randomUUID(), boardA, columnA, userB],
    );
    await expect(
      client.query(
        `insert into board_members(board_id,user_id,role) values ($1,$2,'member')`,
        [boardA, userA],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('allows cleanup of a running timer after access is revoked', async () => {
    const taskId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,position)
       values ($1,$2,$3,'timer cleanup',$4,1)`,
      [taskId, boardB, columnB, userB],
    );
    await client.query(
      `insert into time_entries(id,task_id,user_id,started_at)
       values ($1,$2,$3,now())`,
      [entryId, taskId, userB],
    );
    await client.query(
      `delete from board_members where board_id=$1 and user_id=$2`,
      [boardB, userB],
    );
    await expect(
      client.query(`update time_entries set stopped_at=now() where id=$1`, [
        entryId,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      client.query(
        `insert into time_entries(id,task_id,user_id,started_at)
         values ($1,$2,$3,now())`,
        [crypto.randomUUID(), taskId, userB],
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
  it('awards creation and first completion once, including legacy SQL writers', async () => {
    const taskId = crypto.randomUUID();
    await client.query(
      `insert into tasks(id,board_id,column_id,title,author_id,assignee_id,position)
       values($1,$2,$3,'Contribution',$4,$4,1)`,
      [taskId, boardA, columnA, userA],
    );
    expect(
      (
        await client.query(
          'select kind,points from contribution_events where task_id=$1',
          [taskId],
        )
      ).rows,
    ).toEqual([{ kind: 'created', points: 2 }]);
    await client.query('update tasks set completed_at=now() where id=$1', [
      taskId,
    ]);
    await client.query('update tasks set completed_at=null where id=$1', [
      taskId,
    ]);
    await client.query('update tasks set completed_at=now() where id=$1', [
      taskId,
    ]);
    const points = await client.query(
      'select sum(points)::int as total,count(*)::int as count from contribution_events where task_id=$1',
      [taskId],
    );
    expect(points.rows[0]).toEqual({ total: 12, count: 2 });
    await client.query('delete from tasks where id=$1', [taskId]);
    expect(
      (
        await client.query(
          'select * from contribution_events where task_id=$1',
          [taskId],
        )
      ).rowCount,
    ).toBe(0);
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
