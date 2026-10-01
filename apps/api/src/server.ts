import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import multipart from '@fastify/multipart';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { db, pool } from './db/client.js';
import {
  attachments,
  boardMembers,
  boards,
  columns,
  departments,
  labels,
  sessions,
  taskLabels,
  taskEvents,
  tasks,
  timeEntries,
  timeEntryCorrections,
  topics,
  users,
} from './db/schema.js';
import {
  defaultColumns,
  hashToken,
  normalizeEmail,
  parseDateInput,
} from './domain.js';
import { assertBootstrapCredentials, loadRuntimeConfig } from './config.js';
const runtime = loadRuntimeConfig();
const cookieName = 'kanban_session',
  bodyLimit = 16 * 1024,
  sessionOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: runtime.sessionCookieSecure,
    maxAge: 2592000,
  };
const forbiddenAssigneeNameCharacters =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const credentials = z
    .object({
      email: z.string().trim().email().max(254),
      password: z.string().min(10).max(256),
    })
    .strict(),
  boardInput = z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  boardCreateInput = z
    .object({
      name: z.string().trim().min(1).max(120),
      departmentId: z.string().uuid(),
    })
    .strict(),
  boardPatchInput = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      departmentId: z.string().uuid().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0),
  date = z.string().transform((value, context) => {
    const parsed = parseDateInput(value);
    if (!parsed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid date',
      });
      return z.NEVER;
    }
    return parsed;
  });
const assigneeName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !forbiddenAssigneeNameCharacters.test(value))
  .nullable();
const fields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000),
  assigneeId: z.string().uuid().nullable(),
  assigneeName,
  topicId: z.string().uuid().nullable(),
  labelIds: z
    .array(z.string().uuid())
    .max(30)
    .transform((v) => [...new Set(v)]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  dueAt: date.nullable(),
  estimatedMinutes: z.number().int().min(0).max(1000000).nullable(),
};
const taskCreate = z
  .object({
    columnId: z.string().uuid(),
    title: fields.title,
    description: fields.description.optional().default(''),
    assigneeId: fields.assigneeId.optional().default(null),
    assigneeName: fields.assigneeName.optional().default(null),
    topicId: fields.topicId.optional().default(null),
    labelIds: fields.labelIds.optional().default([]),
    color: fields.color.optional().default(null),
    dueAt: fields.dueAt.optional().default(null),
    estimatedMinutes: fields.estimatedMinutes.optional().default(null),
  })
  .strict()
  .refine((value) => !(value.assigneeId && value.assigneeName));
const taskPatch = z
  .object({
    title: fields.title.optional(),
    description: fields.description.optional(),
    assigneeId: fields.assigneeId.optional(),
    assigneeName: fields.assigneeName.optional(),
    topicId: fields.topicId.optional(),
    labelIds: fields.labelIds.optional(),
    color: fields.color.optional(),
    dueAt: fields.dueAt.optional(),
    estimatedMinutes: fields.estimatedMinutes.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0)
  .refine((value) => !(value.assigneeId && value.assigneeName));
const moveInput = z
  .object({
    columnId: z.string().uuid(),
    beforeTaskId: z.string().uuid().nullable().optional(),
  })
  .strict();
type User = { id: string; email: string; role: 'admin' | 'member' };
const id = (r: FastifyRequest, n: string) =>
  z
    .string()
    .uuid()
    .safeParse((r.params as Record<string, string>)[n]);
async function seedAdmin() {
  const email = process.env.INITIAL_ADMIN_EMAIL,
    password = process.env.INITIAL_ADMIN_PASSWORD;
  const count = await pool.query<{ count: string }>(
    'select count(*)::text as count from users',
  );
  assertBootstrapCredentials(process.env, Number(count.rows[0]!.count));
  if (!email || !password) return;
  const normalized = normalizeEmail(email);
  if (
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1)
    )[0]
  )
    return;
  await db.insert(users).values({
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
    role: 'admin',
  });
}
async function member(boardId: string, userId: string) {
  return Boolean(
    (
      await db
        .select({ id: boards.id })
        .from(boards)
        .innerJoin(boardMembers, eq(boardMembers.boardId, boards.id))
        .where(
          and(
            eq(boards.id, boardId),
            eq(boardMembers.userId, userId),
            isNull(boards.archivedAt),
          ),
        )
        .limit(1)
    )[0],
  );
}
async function boardAdmin(boardId: string, userId: string) {
  return Boolean(
    (
      await db
        .select({ id: boardMembers.userId })
        .from(boardMembers)
        .innerJoin(boards, eq(boards.id, boardMembers.boardId))
        .where(
          and(
            eq(boardMembers.boardId, boardId),
            eq(boardMembers.userId, userId),
            eq(boardMembers.role, 'admin'),
            isNull(boards.archivedAt),
          ),
        )
        .limit(1)
    )[0],
  );
}
async function boardOr404(
  boardId: string,
  userId: string,
  reply: FastifyReply,
) {
  if (await member(boardId, userId)) return true;
  reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
  return false;
}
async function activeTask(boardId: string, taskId: string) {
  return (
    (
      await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.boardId, boardId),
            isNull(tasks.archivedAt),
          ),
        )
        .limit(1)
    )[0] ?? null
  );
}
async function validateMeta(
  boardId: string,
  input: {
    assigneeId?: string | null;
    topicId?: string | null;
    labelIds?: string[];
  },
) {
  if (input.assigneeId && !(await member(boardId, input.assigneeId)))
    return 'ASSIGNEE_NOT_FOUND';
  if (
    input.topicId &&
    !(
      await db
        .select({ id: topics.id })
        .from(topics)
        .where(
          and(
            eq(topics.id, input.topicId),
            eq(topics.boardId, boardId),
            isNull(topics.archivedAt),
          ),
        )
        .limit(1)
    )[0]
  )
    return 'TOPIC_NOT_FOUND';
  if (input.labelIds?.length) {
    const found = await db
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.boardId, boardId),
          inArray(labels.id, input.labelIds),
          isNull(labels.archivedAt),
        ),
      );
    if (found.length !== input.labelIds.length) return 'LABEL_NOT_FOUND';
  }
  return null;
}
async function boardTasks(boardId: string, includeArchived = false) {
  const rows = await db
    .select({
      id: tasks.id,
      boardId: tasks.boardId,
      columnId: tasks.columnId,
      title: tasks.title,
      description: tasks.description,
      authorId: tasks.authorId,
      assigneeId: tasks.assigneeId,
      assigneeName: tasks.assigneeName,
      topicId: tasks.topicId,
      color: tasks.color,
      dueAt: tasks.dueAt,
      estimatedMinutes: tasks.estimatedMinutes,
      position: tasks.position,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt,
      authorEmail: users.email,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.authorId))
    .where(
      includeArchived
        ? eq(tasks.boardId, boardId)
        : and(eq(tasks.boardId, boardId), isNull(tasks.archivedAt)),
    )
    .orderBy(tasks.columnId, tasks.position);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id),
    links = await db
      .select({
        taskId: taskLabels.taskId,
        id: labels.id,
        name: labels.name,
        color: labels.color,
      })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, ids)),
    files = await db
      .select({
        taskId: attachments.taskId,
        id: attachments.id,
        fileName: attachments.fileName,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(inArray(attachments.taskId, ids));
  return rows.map((row) => ({
    ...row,
    author: { id: row.authorId, email: row.authorEmail },
    labels: links.filter((l) => l.taskId === row.id),
    attachments: files.filter((file) => file.taskId === row.id),
  }));
}
export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit,
    trustProxy: runtime.trustProxy,
  });
  if (runtime.nodeEnv === 'production' && runtime.allowInsecureHttp)
    app.log.warn(
      'Production HTTP is explicitly enabled; restrict access to the trusted internal network',
    );
  const failedSignIns = new Map<string, number[]>();
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10485760, files: 1 } });
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, !origin || runtime.allowedOrigins.has(origin)),
    credentials: true,
  });
  app.addHook('onRequest', async (request, reply) => {
    if (
      runtime.nodeEnv === 'production' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.cookies[cookieName]
    ) {
      const origin = request.headers.origin;
      if (!origin || !runtime.allowedOrigins.has(origin))
        return reply.code(403).send({ code: 'INVALID_ORIGIN' });
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('cache-control', 'private, no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const requestError = error as { code?: string; statusCode?: number };
    if (requestError.code === 'FST_REQ_FILE_TOO_LARGE')
      return reply.code(413).send({ code: 'FILE_TOO_LARGE' });
    if (requestError.statusCode && requestError.statusCode < 500)
      return reply
        .code(requestError.statusCode)
        .send({ code: 'INVALID_REQUEST' });
    request.log.error({ error }, 'Unhandled request error');
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  async function current(r: FastifyRequest): Promise<User | null> {
    const raw = r.cookies[cookieName];
    if (!raw) return null;
    return (
      (
        await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(
            and(
              eq(sessions.tokenHash, hashToken(raw)),
              gt(sessions.expiresAt, new Date()),
              isNull(users.archivedAt),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }
  async function user(r: FastifyRequest, reply: FastifyReply) {
    const u = await current(r);
    if (!u) reply.code(401).send({ code: 'UNAUTHENTICATED' });
    return u;
  }
  async function session(reply: FastifyReply, userId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + sessionOptions.maxAge * 1000),
    });
    reply.setCookie(cookieName, token, sessionOptions);
  }
  app.get('/health', async (_r, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ code: 'DEPENDENCY_UNAVAILABLE' });
    }
  });
  app.get('/auth/me', async (r, reply) => {
    const u = await user(r, reply);
    if (u) return { user: u };
  });
  app.post('/auth/sign-in', async (r, reply) => {
    const p = credentials.safeParse(r.body);
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const attemptKey = `${r.ip}:${normalizeEmail(p.data.email)}`,
      cutoff = Date.now() - 15 * 60 * 1000,
      recentAttempts = (failedSignIns.get(attemptKey) ?? []).filter(
        (timestamp) => timestamp >= cutoff,
      );
    if (recentAttempts.length >= 5)
      return reply
        .header('retry-after', '900')
        .code(429)
        .send({ code: 'SIGN_IN_RATE_LIMITED' });
    const candidate = (
      await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, normalizeEmail(p.data.email)),
            isNull(users.archivedAt),
          ),
        )
        .limit(1)
    )[0];
    if (
      !candidate ||
      !(await argon2.verify(candidate.passwordHash, p.data.password))
    ) {
      failedSignIns.set(attemptKey, [...recentAttempts, Date.now()]);
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
    }
    failedSignIns.delete(attemptKey);
    await db.delete(sessions).where(sql`${sessions.expiresAt} <= now()`);
    await session(reply, candidate.id);
    return {
      user: { id: candidate.id, email: candidate.email, role: candidate.role },
    };
  });
  app.post('/auth/sign-out', async (r, reply) => {
    const raw = r.cookies[cookieName];
    if (raw)
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
    reply.clearCookie(cookieName, { path: '/' });
    return reply.code(204).send();
  });
  app.get('/departments', async (r, reply) => {
    const u = await user(r, reply);
    if (!u) return;
    return {
      departments: await db
        .select({
          id: departments.id,
          name: departments.name,
          createdAt: departments.createdAt,
        })
        .from(departments)
        .orderBy(departments.name, departments.id),
    };
  });
  app.post('/departments', async (r, reply) => {
    const u = await user(r, reply),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (u.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const department = {
      id: crypto.randomUUID(),
      name: p.data.name,
    };
    try {
      await db.insert(departments).values(department);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === '23505'
      )
        return reply.code(409).send({ code: 'DEPARTMENT_NAME_TAKEN' });
      throw error;
    }
    return reply.code(201).send({ department });
  });
  app.patch('/departments/:departmentId', async (r, reply) => {
    const u = await user(r, reply),
      d = id(r, 'departmentId'),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (u.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!d.success)
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    try {
      const updated = await db
        .update(departments)
        .set({ name: p.data.name })
        .where(eq(departments.id, d.data))
        .returning({ id: departments.id });
      if (!updated[0])
        return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === '23505'
      )
        return reply.code(409).send({ code: 'DEPARTMENT_NAME_TAKEN' });
      throw error;
    }
    return reply.code(204).send();
  });
  app.get('/boards', async (r, reply) => {
    const u = await user(r, reply);
    if (!u) return;
    const includeArchived =
      (r.query as Record<string, string | undefined>).archived === 'true';
    return {
      boards: await db
        .select({
          id: boards.id,
          name: boards.name,
          departmentId: boards.departmentId,
          createdAt: boards.createdAt,
          archivedAt: boards.archivedAt,
        })
        .from(boards)
        .innerJoin(boardMembers, eq(boardMembers.boardId, boards.id))
        .where(
          includeArchived
            ? and(
                eq(boardMembers.userId, u.id),
                eq(boardMembers.role, 'admin'),
                isNotNull(boards.archivedAt),
              )
            : and(eq(boardMembers.userId, u.id), isNull(boards.archivedAt)),
        )
        .orderBy(boards.createdAt),
    };
  });
  app.post('/boards', async (r, reply) => {
    const u = await user(r, reply),
      p = boardCreateInput.safeParse(r.body);
    if (!u) return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (
      !(
        await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, p.data.departmentId))
          .limit(1)
      )[0]
    )
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    const board = {
      id: crypto.randomUUID(),
      name: p.data.name,
      departmentId: p.data.departmentId,
      createdBy: u.id,
    };
    await db.transaction(async (tx) => {
      await tx.insert(boards).values(board);
      await tx
        .insert(boardMembers)
        .values({ boardId: board.id, userId: u.id, role: 'admin' });
      await tx.insert(columns).values(
        defaultColumns.map((name, i) => ({
          id: crypto.randomUUID(),
          boardId: board.id,
          name,
          position: String(i + 1),
        })),
      );
      await tx.insert(topics).values({
        id: crypto.randomUUID(),
        boardId: board.id,
        name: 'Общее',
        color: '#64748b',
      });
      await tx.insert(labels).values([
        {
          id: crypto.randomUUID(),
          boardId: board.id,
          name: 'Важно',
          color: '#dc2626',
        },
        {
          id: crypto.randomUUID(),
          boardId: board.id,
          name: 'Блокер',
          color: '#7c3aed',
        },
      ]);
    });
    return reply.code(201).send({ board });
  });
  app.get('/boards/:id', async (r, reply) => {
    const u = await user(r, reply),
      p = id(r, 'id');
    if (!u) return;
    if (!p.success || !(await boardOr404(p.data, u.id, reply))) return;
    const includeArchived =
      (r.query as Record<string, string | undefined>).archived === 'true';
    const board = (
      await db
        .select({
          id: boards.id,
          name: boards.name,
          departmentId: boards.departmentId,
          createdAt: boards.createdAt,
        })
        .from(boards)
        .where(eq(boards.id, p.data))
        .limit(1)
    )[0]!;
    const cs = await db
        .select({
          id: columns.id,
          name: columns.name,
          position: columns.position,
        })
        .from(columns)
        .where(and(eq(columns.boardId, p.data), isNull(columns.archivedAt)))
        .orderBy(columns.position),
      rawTasks = await boardTasks(p.data, includeArchived),
      members = await db
        .select({
          id: users.id,
          email: users.email,
          role: boardMembers.role,
        })
        .from(boardMembers)
        .innerJoin(users, eq(users.id, boardMembers.userId))
        .where(eq(boardMembers.boardId, p.data)),
      boardTopics = await db
        .select({ id: topics.id, name: topics.name, color: topics.color })
        .from(topics)
        .where(and(eq(topics.boardId, p.data), isNull(topics.archivedAt))),
      boardLabels = await db
        .select({ id: labels.id, name: labels.name, color: labels.color })
        .from(labels)
        .where(and(eq(labels.boardId, p.data), isNull(labels.archivedAt))),
      active = await db
        .select({
          id: timeEntries.id,
          taskId: timeEntries.taskId,
          startedAt: timeEntries.startedAt,
        })
        .from(timeEntries)
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(
          and(
            eq(tasks.boardId, p.data),
            eq(timeEntries.userId, u.id),
            isNull(timeEntries.stoppedAt),
          ),
        );
    const ts = rawTasks.map((task) => ({
      ...task,
      labelIds: task.labels.map((label) => label.id),
      activeTimer: active.find((entry) => entry.taskId === task.id) ?? null,
    }));
    return {
      board,
      members,
      topics: boardTopics,
      labels: boardLabels,
      columns: cs.map((c) => ({
        ...c,
        tasks: ts.filter((t) => t.columnId === c.id),
      })),
    };
  });
  app.post('/boards/:boardId/tasks', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = taskCreate.safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await boardOr404(b.data, u.id, reply))) return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const bad = await validateMeta(b.data, p.data);
    if (bad) return reply.code(404).send({ code: bad });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const column = (
        await tx
          .select({ id: columns.id })
          .from(columns)
          .where(
            and(
              eq(columns.id, p.data.columnId),
              eq(columns.boardId, b.data),
              isNull(columns.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!column) return 'COLUMN_NOT_FOUND' as const;
      const max = (
        await tx
          .select({ v: sql<string>`coalesce(max(${tasks.position}),0)` })
          .from(tasks)
          .where(
            and(eq(tasks.columnId, p.data.columnId), isNull(tasks.archivedAt)),
          )
      )[0]!.v;
      const task = {
        id: crypto.randomUUID(),
        boardId: b.data,
        columnId: p.data.columnId,
        title: p.data.title,
        description: p.data.description,
        authorId: u.id,
        assigneeId: p.data.assigneeId,
        assigneeName: p.data.assigneeName,
        topicId: p.data.topicId,
        color: p.data.color,
        dueAt: p.data.dueAt,
        estimatedMinutes: p.data.estimatedMinutes,
        position: String(Number(max) + 1),
      };
      await tx.insert(tasks).values(task);
      await tx.insert(taskEvents).values({
        id: crypto.randomUUID(),
        taskId: task.id,
        actorId: u.id,
        type: 'created',
      });
      if (p.data.labelIds.length)
        await tx
          .insert(taskLabels)
          .values(
            p.data.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
          );
      return task;
    });
    if (result === 'COLUMN_NOT_FOUND')
      return reply.code(404).send({ code: result });
    return reply.code(201).send({ task: result });
  });
  app.patch('/boards/:boardId/tasks/:taskId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId'),
      p = taskPatch.safeParse(r.body);
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (!(await activeTask(b.data, t.data)))
      return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const bad = await validateMeta(b.data, p.data);
    if (bad) return reply.code(404).send({ code: bad });
    await db.transaction(async (tx) => {
      const { labelIds, ...values } = p.data;
      const assignmentTouched =
        Object.hasOwn(p.data, 'assigneeId') ||
        Object.hasOwn(p.data, 'assigneeName');
      if (assignmentTouched)
        Object.assign(values, {
          assigneeId: p.data.assigneeId ?? null,
          assigneeName: p.data.assigneeName ?? null,
        });
      await tx.execute(
        sql`select id from tasks where id = ${t.data} for update`,
      );
      const previous = (
        await tx
          .select({
            assigneeId: tasks.assigneeId,
            assigneeName: tasks.assigneeName,
          })
          .from(tasks)
          .where(eq(tasks.id, t.data))
          .limit(1)
      )[0];
      await tx
        .update(tasks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(tasks.id, t.data));
      if (labelIds) {
        await tx.delete(taskLabels).where(eq(taskLabels.taskId, t.data));
        if (labelIds.length)
          await tx
            .insert(taskLabels)
            .values(labelIds.map((labelId) => ({ taskId: t.data, labelId })));
      }
      if (
        previous &&
        assignmentTouched &&
        (previous.assigneeId !== (p.data.assigneeId ?? null) ||
          previous.assigneeName !== (p.data.assigneeName ?? null))
      )
        await tx.insert(taskEvents).values({
          id: crypto.randomUUID(),
          taskId: t.data,
          actorId: u.id,
          type: 'assignee_changed',
          fromAssigneeId: previous.assigneeId,
          fromAssigneeName: previous.assigneeName,
          toAssigneeId: p.data.assigneeId ?? null,
          toAssigneeName: p.data.assigneeName ?? null,
        });
    });
    return { task: { id: t.data } };
  });
  app.post('/boards/:boardId/tasks/:taskId/move', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId'),
      p = moveInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const task = (
        await tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, t.data),
              eq(tasks.boardId, b.data),
              isNull(tasks.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!task) return 'TASK_NOT_FOUND';
      const target = (
        await tx
          .select({ id: columns.id, name: columns.name })
          .from(columns)
          .where(
            and(
              eq(columns.id, p.data.columnId),
              eq(columns.boardId, b.data),
              isNull(columns.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!target) return 'COLUMN_NOT_FOUND';
      const terminalColumn = (
        await tx
          .select({ id: columns.id })
          .from(columns)
          .where(and(eq(columns.boardId, b.data), isNull(columns.archivedAt)))
          .orderBy(desc(columns.position))
          .limit(1)
      )[0];
      const sourceColumn = (
        await tx
          .select({ id: columns.id, name: columns.name })
          .from(columns)
          .where(eq(columns.id, task.columnId))
          .limit(1)
      )[0];
      if (!sourceColumn) return 'COLUMN_NOT_FOUND';
      const ids =
        task.columnId === target.id ? [target.id] : [task.columnId, target.id];
      await tx.execute(
        sql`select id from tasks where column_id in ${ids} and archived_at is null for update`,
      );
      const list = async (columnId: string) =>
        tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.columnId, columnId), isNull(tasks.archivedAt)))
          .orderBy(tasks.position, tasks.id);
      const src = await list(task.columnId),
        dst = task.columnId === target.id ? src : await list(target.id),
        without = dst.filter((x) => x.id !== task.id);
      let at = without.length;
      if (p.data.beforeTaskId) {
        at = without.findIndex((x) => x.id === p.data.beforeTaskId);
        if (at < 0) return 'BEFORE_TASK_NOT_FOUND';
      }
      const destination = [
          ...without.slice(0, at),
          { id: task.id },
          ...without.slice(at),
        ],
        source =
          task.columnId === target.id
            ? []
            : src.filter((x) => x.id !== task.id),
        now = new Date();
      for (const [i, x] of source.entries())
        await tx
          .update(tasks)
          .set({ position: String(i + 1), updatedAt: now })
          .where(eq(tasks.id, x.id));
      for (const [i, x] of destination.entries())
        await tx
          .update(tasks)
          .set({
            columnId: target.id,
            position: String(i + 1),
            updatedAt: now,
            completedAt:
              x.id !== task.id
                ? undefined
                : terminalColumn?.id === target.id
                  ? (task.completedAt ?? now)
                  : null,
          })
          .where(eq(tasks.id, x.id));
      if (sourceColumn.id !== target.id)
        await tx.insert(taskEvents).values({
          id: crypto.randomUUID(),
          taskId: task.id,
          actorId: u.id,
          type: 'column_changed',
          fromColumnId: sourceColumn.id,
          fromColumnName: sourceColumn.name,
          toColumnId: target.id,
          toColumnName: target.name,
        });
      return { id: task.id, columnId: target.id };
    });
    if (typeof result === 'string')
      return reply.code(404).send({ code: result });
    return { task: result };
  });
  app.get('/boards/:boardId/tasks/:taskId/history', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId');
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    const task = (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, t.data), eq(tasks.boardId, b.data)))
        .limit(1)
    )[0];
    if (!task) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, t.data))
      .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id))
      .limit(100);
    const userIds = [
      ...new Set(
        events.flatMap((event) =>
          [event.actorId, event.fromAssigneeId, event.toAssigneeId].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ),
    ];
    const people = userIds.length
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
    const person = (userId: string | null) =>
      userId ? (people.find((item) => item.id === userId) ?? null) : null;
    const assignee = (userId: string | null, name: string | null) =>
      userId ? person(userId) : name ? { name } : null;
    return {
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        createdAt: event.createdAt,
        actor: person(event.actorId),
        fromColumn:
          event.fromColumnId && event.fromColumnName
            ? { id: event.fromColumnId, name: event.fromColumnName }
            : null,
        toColumn:
          event.toColumnId && event.toColumnName
            ? { id: event.toColumnId, name: event.toColumnName }
            : null,
        fromAssignee: assignee(event.fromAssigneeId, event.fromAssigneeName),
        toAssignee: assignee(event.toAssigneeId, event.toAssigneeName),
      })),
    };
  });
  app.post('/boards/:boardId/tasks/:taskId/archive', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId');
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    if (!(await activeTask(b.data, t.data)))
      return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(timeEntries)
        .set({ stoppedAt: now })
        .where(
          and(eq(timeEntries.taskId, t.data), isNull(timeEntries.stoppedAt)),
        );
      await tx
        .update(tasks)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(tasks.id, t.data));
    });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/tasks/:taskId/restore', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId');
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    const restored = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const task = (
        await tx
          .select({ id: tasks.id, columnId: tasks.columnId })
          .from(tasks)
          .innerJoin(columns, eq(columns.id, tasks.columnId))
          .where(
            and(
              eq(tasks.id, t.data),
              eq(tasks.boardId, b.data),
              isNotNull(tasks.archivedAt),
              isNull(columns.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!task) return false;
      const max = (
        await tx
          .select({ v: sql<string>`coalesce(max(${tasks.position}),0)` })
          .from(tasks)
          .where(
            and(eq(tasks.columnId, task.columnId), isNull(tasks.archivedAt)),
          )
      )[0]!.v;
      await tx
        .update(tasks)
        .set({
          archivedAt: null,
          position: String(Number(max) + 1),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
      return true;
    });
    if (!restored) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    return reply.code(204).send();
  });
  async function owned(taskId: string, userId: string) {
    return Boolean(
      (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .innerJoin(boardMembers, eq(boardMembers.boardId, tasks.boardId))
          .innerJoin(boards, eq(boards.id, tasks.boardId))
          .where(
            and(
              eq(tasks.id, taskId),
              eq(boardMembers.userId, userId),
              isNull(tasks.archivedAt),
              isNull(boards.archivedAt),
            ),
          )
          .limit(1)
      )[0],
    );
  }
  app.post('/tasks/:taskId/timer/start', async (r, reply) => {
    const u = await user(r, reply),
      t = id(r, 'taskId');
    if (!u) return;
    if (!t.success || !(await owned(t.data, u.id)))
      return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const entry = {
      id: crypto.randomUUID(),
      taskId: t.data,
      userId: u.id,
      startedAt: new Date(),
    };
    try {
      await db.insert(timeEntries).values(entry);
      return reply.code(201).send({ entry });
    } catch (e: unknown) {
      if (typeof e === 'object' && e && 'code' in e && e.code === '23505')
        return reply.code(409).send({ code: 'TIMER_ALREADY_RUNNING' });
      throw e;
    }
  });
  app.post('/time-entries/:id/stop', async (r, reply) => {
    const u = await user(r, reply),
      p = id(r, 'id');
    if (!u) return;
    if (!p.success)
      return reply.code(404).send({ code: 'TIME_ENTRY_NOT_FOUND' });
    const entry = (
      await db
        .update(timeEntries)
        .set({ stoppedAt: new Date() })
        .where(
          and(
            eq(timeEntries.id, p.data),
            eq(timeEntries.userId, u.id),
            isNull(timeEntries.stoppedAt),
          ),
        )
        .returning()
    )[0];
    if (!entry) return reply.code(404).send({ code: 'ACTIVE_TIMER_NOT_FOUND' });
    return { entry };
  });
  app.post('/tasks/:taskId/time-entries/manual', async (r, reply) => {
    const u = await user(r, reply),
      t = id(r, 'taskId'),
      p = z
        .object({
          minutes: z.number().int().min(1).max(1440),
          workDate: date,
        })
        .strict()
        .safeParse(r.body);
    if (!u) return;
    if (!t.success || !p.success)
      return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (!(await owned(t.data, u.id)))
      return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const entry = {
      id: crypto.randomUUID(),
      taskId: t.data,
      userId: u.id,
      startedAt: new Date(p.data.workDate.getTime() - p.data.minutes * 60000),
      stoppedAt: p.data.workDate,
    };
    await db.insert(timeEntries).values(entry);
    return reply.code(201).send({ entry });
  });
  app.get('/boards/:boardId/time-entries', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await boardOr404(b.data, u.id, reply))) return;
    return {
      entries: await db
        .select({
          id: timeEntries.id,
          taskId: timeEntries.taskId,
          userId: timeEntries.userId,
          startedAt: timeEntries.startedAt,
          stoppedAt: timeEntries.stoppedAt,
        })
        .from(timeEntries)
        .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
        .where(eq(tasks.boardId, b.data))
        .orderBy(timeEntries.startedAt),
    };
  });
  app.post('/admin/users', async (r, reply) => {
    const u = await user(r, reply),
      p = credentials.safeParse(r.body);
    if (!u) return;
    if (u.role !== 'admin') return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const email = normalizeEmail(p.data.email);
    if (
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      )[0]
    )
      return reply.code(409).send({ code: 'EMAIL_TAKEN' });
    const created = {
      id: crypto.randomUUID(),
      email,
      passwordHash: await argon2.hash(p.data.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      role: 'member' as const,
    };
    await db.insert(users).values(created);
    return reply.code(201).send({
      user: { id: created.id, email: created.email, role: created.role },
    });
  });
  app.patch('/boards/:boardId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = boardPatchInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (
      p.data.departmentId &&
      !(
        await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, p.data.departmentId))
          .limit(1)
      )[0]
    )
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    await db.update(boards).set(p.data).where(eq(boards.id, b.data));
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/archive', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      await tx.execute(sql`
        update time_entries
        set stopped_at = ${now}
        where stopped_at is null
          and task_id in (select id from tasks where board_id = ${b.data})
      `);
      await tx
        .update(boards)
        .set({ archivedAt: now })
        .where(eq(boards.id, b.data));
    });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/restore', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const allowed = (
      await db
        .select({ id: boardMembers.userId })
        .from(boardMembers)
        .where(
          and(
            eq(boardMembers.boardId, b.data),
            eq(boardMembers.userId, u.id),
            eq(boardMembers.role, 'admin'),
          ),
        )
        .limit(1)
    )[0];
    if (!allowed) return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    await db
      .update(boards)
      .set({ archivedAt: null })
      .where(eq(boards.id, b.data));
    return reply.code(204).send();
  });
  app.get('/boards/:boardId/members', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await boardOr404(b.data, u.id, reply))) return;
    return {
      members: await db
        .select({ id: users.id, email: users.email, role: boardMembers.role })
        .from(boardMembers)
        .innerJoin(users, eq(users.id, boardMembers.userId))
        .where(eq(boardMembers.boardId, b.data)),
    };
  });
  app.post('/boards/:boardId/members', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = z
        .object({
          userId: z.string().uuid(),
          role: z.enum(['admin', 'member']).default('member'),
        })
        .strict()
        .safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (
      !(
        await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, p.data.userId), isNull(users.archivedAt)))
          .limit(1)
      )[0]
    )
      return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    try {
      await db
        .insert(boardMembers)
        .values({ boardId: b.data, userId: p.data.userId, role: p.data.role });
    } catch {
      return reply.code(409).send({ code: 'ALREADY_MEMBER' });
    }
    return reply.code(201).send();
  });
  app.delete('/boards/:boardId/members/:userId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      target = id(r, 'userId');
    if (!u) return;
    if (!b.success || !target.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const removed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const membership = (
        await tx
          .select({ role: boardMembers.role })
          .from(boardMembers)
          .where(
            and(
              eq(boardMembers.boardId, b.data),
              eq(boardMembers.userId, target.data),
            ),
          )
          .limit(1)
      )[0];
      if (!membership) return 'NOT_FOUND';
      if (membership.role === 'admin') {
        const admins = await tx
          .select({ id: boardMembers.userId })
          .from(boardMembers)
          .where(
            and(
              eq(boardMembers.boardId, b.data),
              eq(boardMembers.role, 'admin'),
            ),
          );
        if (admins.length === 1) return 'LAST_BOARD_ADMIN';
      }
      const assigned = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(eq(tasks.boardId, b.data), eq(tasks.assigneeId, target.data)),
        );
      const now = new Date();
      for (const task of assigned) {
        await tx
          .update(tasks)
          .set({ assigneeId: null, updatedAt: now })
          .where(eq(tasks.id, task.id));
        await tx.insert(taskEvents).values({
          id: crypto.randomUUID(),
          taskId: task.id,
          actorId: u.id,
          type: 'assignee_changed',
          fromAssigneeId: target.data,
          toAssigneeId: null,
        });
      }
      await tx.execute(sql`
        update time_entries
        set stopped_at = ${now}
        where user_id = ${target.data}
          and stopped_at is null
          and task_id in (select id from tasks where board_id = ${b.data})
      `);
      await tx
        .delete(boardMembers)
        .where(
          and(
            eq(boardMembers.boardId, b.data),
            eq(boardMembers.userId, target.data),
          ),
        );
      return 'OK';
    });
    if (removed === 'LAST_BOARD_ADMIN')
      return reply.code(409).send({ code: 'LAST_BOARD_ADMIN' });
    if (removed === 'NOT_FOUND')
      return reply.code(404).send({ code: 'MEMBER_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/columns', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const column = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const max = (
          await tx
            .select({ v: sql<string>`coalesce(max(${columns.position}),0)` })
            .from(columns)
            .where(and(eq(columns.boardId, b.data), isNull(columns.archivedAt)))
        )[0]!.v,
        created = {
          id: crypto.randomUUID(),
          boardId: b.data,
          name: p.data.name,
          position: String(Number(max) + 1),
        };
      await tx.insert(columns).values(created);
      return created;
    });
    return reply.code(201).send({ column });
  });
  app.patch('/boards/:boardId/columns/:columnId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      c = id(r, 'columnId'),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !c.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const result = await db
      .update(columns)
      .set({ name: p.data.name })
      .where(
        and(
          eq(columns.id, c.data),
          eq(columns.boardId, b.data),
          isNull(columns.archivedAt),
        ),
      )
      .returning({ id: columns.id });
    if (!result[0]) return reply.code(404).send({ code: 'COLUMN_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/columns/:columnId/archive', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      c = id(r, 'columnId');
    if (!u) return;
    if (!b.success || !c.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const target = (
        await tx
          .select({ id: columns.id })
          .from(columns)
          .where(
            and(
              eq(columns.id, c.data),
              eq(columns.boardId, b.data),
              isNull(columns.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!target) return 'COLUMN_NOT_FOUND';
      if (
        (
          await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.columnId, c.data))
            .limit(1)
        )[0]
      )
        return 'COLUMN_HAS_TASKS';
      const activeColumns = await tx
        .select({ id: columns.id })
        .from(columns)
        .where(and(eq(columns.boardId, b.data), isNull(columns.archivedAt)))
        .limit(2);
      if (activeColumns.length <= 1) return 'LAST_COLUMN';
      await tx
        .update(columns)
        .set({ archivedAt: new Date() })
        .where(eq(columns.id, c.data));
      return 'OK';
    });
    if (result !== 'OK')
      return reply
        .code(result === 'COLUMN_NOT_FOUND' ? 404 : 409)
        .send({ code: result });
    return reply.code(204).send();
  });
  app.get('/boards/:boardId/columns/archived', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    return {
      columns: await db
        .select({
          id: columns.id,
          name: columns.name,
          archivedAt: columns.archivedAt,
        })
        .from(columns)
        .where(and(eq(columns.boardId, b.data), isNotNull(columns.archivedAt)))
        .orderBy(desc(columns.archivedAt)),
    };
  });
  app.post('/boards/:boardId/columns/:columnId/restore', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      c = id(r, 'columnId');
    if (!u) return;
    if (!b.success || !c.success || !(await boardAdmin(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const restored = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const target = (
        await tx
          .select({ id: columns.id })
          .from(columns)
          .where(
            and(
              eq(columns.id, c.data),
              eq(columns.boardId, b.data),
              isNotNull(columns.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!target) return false;
      const max = (
        await tx
          .select({ v: sql<string>`coalesce(max(${columns.position}),0)` })
          .from(columns)
          .where(and(eq(columns.boardId, b.data), isNull(columns.archivedAt)))
      )[0]!.v;
      await tx
        .update(columns)
        .set({ archivedAt: null, position: String(Number(max) + 1) })
        .where(eq(columns.id, c.data));
      return true;
    });
    if (!restored) return reply.code(404).send({ code: 'COLUMN_NOT_FOUND' });
    return reply.code(204).send();
  });
  async function taxonomy(
    r: FastifyRequest,
    reply: FastifyReply,
    kind: 'topics' | 'labels',
  ) {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = z
        .object({
          name: z.string().trim().min(1).max(80),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .optional(),
        })
        .strict()
        .safeParse(r.body);
    if (!u || !b.success || !(await boardAdmin(b.data, u.id))) return null;
    if (!p.success) {
      reply.code(400).send({ code: 'VALIDATION_ERROR' });
      return null;
    }
    const table = kind === 'topics' ? topics : labels;
    const item = {
      id: crypto.randomUUID(),
      boardId: b.data,
      name: p.data.name,
      color: p.data.color ?? null,
    };
    try {
      await db.insert(table).values(item);
      return item;
    } catch {
      reply.code(409).send({ code: 'DUPLICATE_NAME' });
      return null;
    }
  }
  app.post('/boards/:boardId/topics', async (r, reply) => {
    const item = await taxonomy(r, reply, 'topics');
    return item ? reply.code(201).send({ topic: item }) : undefined;
  });
  app.post('/boards/:boardId/labels', async (r, reply) => {
    const item = await taxonomy(r, reply, 'labels');
    return item ? reply.code(201).send({ label: item }) : undefined;
  });
  app.patch('/time-entries/:id/manual', async (r, reply) => {
    const u = await user(r, reply),
      e = id(r, 'id'),
      p = z
        .object({
          startedAt: date,
          stoppedAt: date,
          reason: z.string().trim().min(1).max(500),
        })
        .strict()
        .refine((v) => v.stoppedAt >= v.startedAt)
        .safeParse(r.body);
    if (!u) return;
    if (!e.success)
      return reply.code(404).send({ code: 'TIME_ENTRY_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const entry = (
      await db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.id, e.data), eq(timeEntries.userId, u.id)))
        .limit(1)
    )[0];
    if (!entry || !entry.stoppedAt)
      return reply.code(404).send({ code: 'TIME_ENTRY_NOT_FOUND' });
    await db.transaction(async (tx) => {
      await tx.insert(timeEntryCorrections).values({
        id: crypto.randomUUID(),
        timeEntryId: entry.id,
        correctedBy: u.id,
        previousStartedAt: entry.startedAt,
        previousStoppedAt: entry.stoppedAt!,
        startedAt: p.data.startedAt,
        stoppedAt: p.data.stoppedAt,
        reason: p.data.reason,
      });
      await tx
        .update(timeEntries)
        .set({ startedAt: p.data.startedAt, stoppedAt: p.data.stoppedAt })
        .where(eq(timeEntries.id, entry.id));
    });
    return reply.code(204).send();
  });
  app.post('/tasks/:taskId/attachments', async (r, reply) => {
    const u = await user(r, reply),
      t = id(r, 'taskId');
    if (!u) return;
    if (!t.success || !(await owned(t.data, u.id)))
      return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const file = await r.file();
    if (!file) return reply.code(400).send({ code: 'FILE_REQUIRED' });
    const data = await file.toBuffer();
    if (!data.length) return reply.code(400).send({ code: 'FILE_REQUIRED' });
    const safeName = file.filename
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 255);
    if (!safeName) return reply.code(400).send({ code: 'INVALID_FILE_NAME' });
    const attachmentId = crypto.randomUUID(),
      storage = `${attachmentId}.bin`,
      dir = runtime.uploadDir,
      path = join(dir, storage);
    await mkdir(dir, { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    try {
      await pool.query(
        'insert into attachments(id,task_id,uploaded_by,file_name,mime_type,size_bytes,storage_path) values($1,$2,$3,$4,$5,$6,$7)',
        [
          attachmentId,
          t.data,
          u.id,
          safeName,
          file.mimetype,
          data.length,
          storage,
        ],
      );
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
    return reply.code(201).send({
      attachment: {
        id: attachmentId,
        fileName: safeName,
        mimeType: file.mimetype,
        sizeBytes: data.length,
      },
    });
  });
  app.get('/attachments/:attachmentId', async (r, reply) => {
    const u = await user(r, reply),
      a = id(r, 'attachmentId');
    if (!u) return;
    if (!a.success)
      return reply.code(404).send({ code: 'ATTACHMENT_NOT_FOUND' });
    const result = await pool.query(
      'select a.file_name,a.mime_type,a.storage_path from attachments a join tasks t on t.id=a.task_id join board_members bm on bm.board_id=t.board_id where a.id=$1 and bm.user_id=$2',
      [a.data, u.id],
    );
    if (!result.rows[0])
      return reply.code(404).send({ code: 'ATTACHMENT_NOT_FOUND' });
    reply
      .type(result.rows[0].mime_type)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(result.rows[0].file_name)}`,
      );
    return reply.send(
      createReadStream(join(runtime.uploadDir, result.rows[0].storage_path)),
    );
  });
  return app;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await seedAdmin();
    const app = await buildApp();
    await app.listen({ port: runtime.port, host: runtime.host });
    const close = async () => {
      await app.close();
      await pool.end();
    };
    process.once('SIGTERM', () => void close());
    process.once('SIGINT', () => void close());
  } catch (error) {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  }
}
