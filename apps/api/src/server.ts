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
  departmentMembers,
  labels,
  notifications,
  sessions,
  taskLabels,
  taskEvents,
  tasks,
  timeEntries,
  timeEntryCorrections,
  topics,
  users,
} from './db/schema.js';
import { sendTaskCompletedEmail } from './mail.js';
import {
  defaultColumns,
  hashToken,
  normalizeEmail,
  parseDateInput,
} from './domain.js';
import {
  canChangeAccountRole,
  canManageAccount,
  isElevated,
  type AccountRole,
} from './policy.js';
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
const personName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !forbiddenAssigneeNameCharacters.test(value))
  .nullable();
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
const accountRole = z.enum(['superadmin', 'admin', 'user']);
const workEmail = z.string().trim().email().max(254).transform(normalizeEmail);
const adminUserCreateInput = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(10).max(256),
    role: accountRole.default('user'),
    firstName: personName.optional().default(null),
    lastName: personName.optional().default(null),
  })
  .strict();
const adminUserPatchInput = z
  .object({
    password: z.string().min(10).max(256).optional(),
    role: accountRole.optional(),
    firstName: personName.optional(),
    lastName: personName.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const profilePatchInput = z.object({ workEmail }).strict();
const accessInput = z
  .object({
    departmentIds: z
      .array(z.string().uuid())
      .max(200)
      .transform((v) => [...new Set(v)]),
    boardIds: z
      .array(z.string().uuid())
      .max(500)
      .transform((v) => [...new Set(v)]),
  })
  .strict();
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
type User = {
  id: string;
  email: string;
  workEmail: string | null;
  role: AccountRole;
  firstName: string | null;
  lastName: string | null;
};
const id = (r: FastifyRequest, n: string) =>
  z
    .string()
    .uuid()
    .safeParse((r.params as Record<string, string>)[n]);
const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
async function seedSuperadmin() {
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
    workEmail: normalized,
    passwordHash: await hashPassword(password),
    role: 'superadmin',
  });
}
async function member(
  boardId: string,
  userId: string,
  includeArchivedBoard = false,
) {
  const result = await pool.query<{ exists: boolean }>(
    `select exists(
       select 1 from boards b join users u on u.id = $2
       where b.id = $1 and u.archived_at is null
         and ($3::boolean or b.archived_at is null)
         and (u.role in ('superadmin', 'admin')
           or exists (select 1 from board_members bm where bm.board_id=b.id and bm.user_id=u.id)
           or exists (select 1 from department_members dm where dm.department_id=b.department_id and dm.user_id=u.id))
     ) as exists`,
    [boardId, userId, includeArchivedBoard],
  );
  return result.rows[0]?.exists ?? false;
}

async function departmentVisible(departmentId: string, user: User) {
  if (isElevated(user.role))
    return Boolean(
      (
        await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, departmentId))
          .limit(1)
      )[0],
    );
  return Boolean(
    (
      await db
        .select({ id: departments.id })
        .from(departments)
        .leftJoin(
          departmentMembers,
          eq(departmentMembers.departmentId, departments.id),
        )
        .leftJoin(boards, eq(boards.departmentId, departments.id))
        .leftJoin(boardMembers, eq(boardMembers.boardId, boards.id))
        .where(
          and(
            eq(departments.id, departmentId),
            sql`(${departmentMembers.userId} = ${user.id} or ${boardMembers.userId} = ${user.id})`,
          ),
        )
        .limit(1)
    )[0],
  );
}

async function assignedToDepartment(departmentId: string, user: User) {
  if (isElevated(user.role)) return true;
  return Boolean(
    (
      await db
        .select({ userId: departmentMembers.userId })
        .from(departmentMembers)
        .where(
          and(
            eq(departmentMembers.departmentId, departmentId),
            eq(departmentMembers.userId, user.id),
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
  includeArchivedBoard = false,
) {
  if (await member(boardId, userId, includeArchivedBoard)) return true;
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
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
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
    author: {
      id: row.authorId,
      email: row.authorEmail,
      firstName: row.authorFirstName,
      lastName: row.authorLastName,
    },
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
          .select({
            id: users.id,
            email: users.email,
            workEmail: users.workEmail,
            role: users.role,
            firstName: users.firstName,
            lastName: users.lastName,
          })
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
  app.patch('/auth/me', async (r, reply) => {
    const u = await user(r, reply),
      p = profilePatchInput.safeParse(r.body);
    if (!u) return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    await db
      .update(users)
      .set({ workEmail: p.data.workEmail })
      .where(eq(users.id, u.id));
    return { user: { ...u, workEmail: p.data.workEmail } };
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
      user: {
        id: candidate.id,
        email: candidate.email,
        workEmail: candidate.workEmail,
        role: candidate.role,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
      },
    };
  });
  app.post('/auth/sign-out', async (r, reply) => {
    const raw = r.cookies[cookieName];
    if (raw)
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
    reply.clearCookie(cookieName, { path: '/' });
    return reply.code(204).send();
  });
  app.get('/notifications', async (r, reply) => {
    const u = await user(r, reply);
    if (!u) return;
    const items = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        taskId: notifications.taskId,
        boardId: notifications.boardId,
        taskTitle: notifications.taskTitle,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorEmail: users.email,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.actorId))
      .where(eq(notifications.userId, u.id))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(50);
    return {
      notifications: items.map((item) => ({
        id: item.id,
        type: item.type,
        taskId: item.taskId,
        boardId: item.boardId,
        taskTitle: item.taskTitle,
        readAt: item.readAt,
        createdAt: item.createdAt,
        actor: {
          email: item.actorEmail,
          firstName: item.actorFirstName,
          lastName: item.actorLastName,
        },
      })),
      unreadCount: items.filter((item) => !item.readAt).length,
    };
  });
  app.post('/notifications/:notificationId/read', async (r, reply) => {
    const u = await user(r, reply),
      n = id(r, 'notificationId');
    if (!u) return;
    if (!n.success)
      return reply.code(404).send({ code: 'NOTIFICATION_NOT_FOUND' });
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, n.data), eq(notifications.userId, u.id)))
      .returning({ id: notifications.id });
    if (!updated[0])
      return reply.code(404).send({ code: 'NOTIFICATION_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.get('/departments', async (r, reply) => {
    const u = await user(r, reply);
    if (!u) return;
    if (isElevated(u.role))
      return {
        departments: await db
          .select({
            id: departments.id,
            name: departments.name,
            createdAt: departments.createdAt,
            canManage: sql<boolean>`true`,
          })
          .from(departments)
          .orderBy(departments.name, departments.id),
      };
    return {
      departments: (
        await pool.query(
          `select d.id,d.name,d.created_at as "createdAt",
                  bool_or(dm.user_id is not null) as "canManage"
         from departments d
         left join department_members dm on dm.department_id=d.id and dm.user_id=$1
         left join boards b on b.department_id=d.id
         left join board_members bm on bm.board_id=b.id and bm.user_id=$1
         where dm.user_id is not null or bm.user_id is not null
         group by d.id,d.name,d.created_at
         order by d.name,d.id`,
          [u.id],
        )
      ).rows,
    };
  });
  app.post('/departments', async (r, reply) => {
    const u = await user(r, reply),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const department = {
      id: crypto.randomUUID(),
      name: p.data.name,
      canManage: true,
    };
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(departments)
          .values({ id: department.id, name: department.name });
        if (u.role === 'user')
          await tx
            .insert(departmentMembers)
            .values({ departmentId: department.id, userId: u.id });
      });
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
    if (!d.success)
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (!(await assignedToDepartment(d.data, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
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
  app.delete('/departments/:departmentId', async (r, reply) => {
    const u = await user(r, reply),
      d = id(r, 'departmentId');
    if (!u) return;
    if (!d.success)
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    if (!(await assignedToDepartment(d.data, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    const result = await db.transaction(async (tx) => {
      const department = await tx.execute(
        sql`select id from departments where id = ${d.data} for update`,
      );
      if (!department.rows[0]) return 'DEPARTMENT_NOT_FOUND';
      const existingBoard = (
        await tx
          .select({ id: boards.id })
          .from(boards)
          .where(eq(boards.departmentId, d.data))
          .limit(1)
      )[0];
      if (existingBoard) return 'DEPARTMENT_HAS_BOARDS';
      await tx.delete(departments).where(eq(departments.id, d.data));
      return 'OK';
    });
    if (result === 'DEPARTMENT_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'DEPARTMENT_HAS_BOARDS')
      return reply.code(409).send({ code: result });
    return reply.code(204).send();
  });
  app.get('/departments/:departmentId/members', async (r, reply) => {
    const u = await user(r, reply),
      d = id(r, 'departmentId');
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!d.success || !(await departmentVisible(d.data, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    return {
      members: await db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          accountRole: users.role,
          archivedAt: users.archivedAt,
        })
        .from(departmentMembers)
        .innerJoin(users, eq(users.id, departmentMembers.userId))
        .where(eq(departmentMembers.departmentId, d.data))
        .orderBy(users.email, users.id),
    };
  });
  app.post('/departments/:departmentId/members', async (r, reply) => {
    const u = await user(r, reply),
      d = id(r, 'departmentId'),
      p = z.object({ userId: z.string().uuid() }).strict().safeParse(r.body);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!d.success || !(await departmentVisible(d.data, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    try {
      const added = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
        );
        const target = (
          await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.id, p.data.userId),
                eq(users.role, 'user'),
                isNull(users.archivedAt),
              ),
            )
            .limit(1)
        )[0];
        if (!target) return false;
        await tx
          .insert(departmentMembers)
          .values({ departmentId: d.data, userId: p.data.userId });
        return true;
      });
      if (!added) return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === '23505'
      )
        return reply.code(409).send({ code: 'ALREADY_MEMBER' });
      throw error;
    }
    return reply.code(201).send();
  });
  app.delete('/departments/:departmentId/members/:userId', async (r, reply) => {
    const u = await user(r, reply),
      d = id(r, 'departmentId'),
      target = id(r, 'userId');
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!d.success || !target.success || !(await departmentVisible(d.data, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    const removed = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(departmentMembers)
        .where(
          and(
            eq(departmentMembers.departmentId, d.data),
            eq(departmentMembers.userId, target.data),
          ),
        )
        .returning({ userId: departmentMembers.userId });
      if (!deleted[0]) return false;
      const now = new Date();
      await tx.execute(sql`
        insert into task_events(id, task_id, actor_id, type, from_assignee_id)
        select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
        from tasks t
        where t.assignee_id = ${target.data}
          and t.board_id in (select id from boards where department_id = ${d.data})
          and not kanban_has_board_access(t.board_id, ${target.data})
      `);
      await tx.execute(sql`
        update tasks set assignee_id = null, updated_at = ${now}
        where assignee_id = ${target.data}
          and board_id in (select id from boards where department_id = ${d.data})
          and not kanban_has_board_access(board_id, ${target.data})
      `);
      await tx.execute(sql`
        update time_entries set stopped_at = ${now}
        where user_id = ${target.data} and stopped_at is null
          and task_id in (
            select t.id from tasks t join boards b on b.id=t.board_id
            where b.department_id = ${d.data} and not kanban_has_board_access(t.board_id, ${target.data})
          )
      `);
      return true;
    });
    if (!removed) return reply.code(404).send({ code: 'MEMBER_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.get('/boards', async (r, reply) => {
    const u = await user(r, reply);
    if (!u) return;
    const includeArchived =
      (r.query as Record<string, string | undefined>).archived === 'true';
    return {
      boards: (
        await pool.query(
          `select b.id,b.name,b.department_id as "departmentId",b.created_at as "createdAt",b.archived_at as "archivedAt"
         from boards b
         where ($2::boolean = (b.archived_at is not null))
           and ( $3::boolean
             or exists (select 1 from board_members bm where bm.board_id=b.id and bm.user_id=$1)
             or exists (select 1 from department_members dm where dm.department_id=b.department_id and dm.user_id=$1))
         order by b.created_at`,
          [u.id, includeArchived, isElevated(u.role)],
        )
      ).rows,
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
    if (!(await assignedToDepartment(p.data.departmentId, u)))
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    const board = {
      id: crypto.randomUUID(),
      name: p.data.name,
      departmentId: p.data.departmentId,
      createdBy: u.id,
    };
    await db.transaction(async (tx) => {
      await tx.insert(boards).values(board);
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
    const includeArchived =
      (r.query as Record<string, string | undefined>).archived === 'true';
    if (!p.success || !(await boardOr404(p.data, u.id, reply, includeArchived)))
      return;
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
      members = (
        await pool.query(
          `select u.id,u.email,u.first_name as "firstName",u.last_name as "lastName",'member'::text as role,u.role as "accountRole",u.archived_at as "archivedAt",
          case when u.role in ('superadmin','admin') then 'global'
               when bm.user_id is not null and dm.user_id is not null then 'both'
               when bm.user_id is not null then 'board'
               else 'department' end as "accessSource"
         from users u
         left join board_members bm on bm.board_id=$1 and bm.user_id=u.id
         left join department_members dm on dm.department_id=(select department_id from boards where id=$1) and dm.user_id=u.id
         where u.archived_at is null and (u.role in ('superadmin','admin') or bm.user_id is not null or dm.user_id is not null)
         order by u.last_name nulls last,u.first_name nulls last,u.email,u.id`,
          [p.data],
        )
      ).rows,
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
      if (task.assigneeId && task.assigneeId !== u.id)
        await tx.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: task.assigneeId,
          actorId: u.id,
          taskId: task.id,
          boardId: task.boardId,
          taskTitle: task.title,
          type: 'task_assigned',
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
      if (
        previous &&
        assignmentTouched &&
        p.data.assigneeId &&
        p.data.assigneeId !== u.id &&
        p.data.assigneeId !== previous.assigneeId
      )
        await tx.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: p.data.assigneeId,
          actorId: u.id,
          taskId: t.data,
          boardId: b.data,
          taskTitle:
            p.data.title ??
            (
              await tx
                .select({ title: tasks.title })
                .from(tasks)
                .where(eq(tasks.id, t.data))
                .limit(1)
            )[0]!.title,
          type: 'task_assigned',
        });
    });
    return { task: { id: t.data } };
  });
  app.post('/boards/:boardId/tasks/:taskId/complete', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      t = id(r, 'taskId');
    if (!u) return;
    if (!b.success || !t.success || !(await boardOr404(b.data, u.id, reply)))
      return;
    const result = await db.transaction(async (tx) => {
      const task = (
        await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            authorId: tasks.authorId,
            completedAt: tasks.completedAt,
            authorWorkEmail: users.workEmail,
            authorEmail: users.email,
          })
          .from(tasks)
          .innerJoin(users, eq(users.id, tasks.authorId))
          .where(
            and(
              eq(tasks.id, t.data),
              eq(tasks.boardId, b.data),
              isNull(tasks.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!task) return 'TASK_NOT_FOUND' as const;
      if (task.completedAt) return 'TASK_ALREADY_COMPLETED' as const;
      const now = new Date();
      await tx
        .update(tasks)
        .set({ completedAt: now, updatedAt: now })
        .where(eq(tasks.id, task.id));
      await tx.insert(taskEvents).values({
        id: crypto.randomUUID(),
        taskId: task.id,
        actorId: u.id,
        type: 'completed',
      });
      const board = (
        await tx
          .select({ name: boards.name })
          .from(boards)
          .where(eq(boards.id, b.data))
          .limit(1)
      )[0];
      return { ...task, boardName: board?.name ?? '', completedAt: now };
    });
    if (result === 'TASK_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'TASK_ALREADY_COMPLETED')
      return reply.code(409).send({ code: result });
    if (result.authorId !== u.id)
      try {
        await sendTaskCompletedEmail(runtime.mail, {
          to: result.authorWorkEmail ?? result.authorEmail,
          taskTitle: result.title,
          boardName: result.boardName,
          completedBy:
            [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email,
        });
      } catch (error) {
        r.log.error(
          { error, taskId: result.id },
          'Task completion email failed',
        );
      }
    return { task: { id: result.id, completedAt: result.completedAt } };
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
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
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
    const result = await pool.query<{ exists: boolean }>(
      `select exists(select 1 from tasks t where t.id=$1 and t.archived_at is null and kanban_has_board_access(t.board_id,$2)) as exists`,
      [taskId, userId],
    );
    return result.rows[0]?.exists ?? false;
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
    const active = (
      await db
        .select({ taskId: timeEntries.taskId })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.id, p.data),
            eq(timeEntries.userId, u.id),
            isNull(timeEntries.stoppedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!active || !(await owned(active.taskId, u.id)))
      return reply.code(404).send({ code: 'ACTIVE_TIMER_NOT_FOUND' });
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
  app.get('/admin/users', async (r, reply) => {
    const u = await user(r, reply),
      p = z
        .object({
          status: z.enum(['active', 'archived', 'all']).default('active'),
        })
        .strict()
        .safeParse(r.query);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const statusFilter =
      p.data.status === 'active'
        ? isNull(users.archivedAt)
        : p.data.status === 'archived'
          ? isNotNull(users.archivedAt)
          : undefined;
    const baseUsers = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        firstName: users.firstName,
        lastName: users.lastName,
        createdAt: users.createdAt,
        archivedAt: users.archivedAt,
      })
      .from(users)
      .where(
        and(
          statusFilter,
          u.role === 'admin' ? eq(users.role, 'user') : undefined,
        ),
      )
      .orderBy(users.email, users.id);
    const userIds = baseUsers.map((item) => item.id);
    const [departmentLinks, boardLinks] = userIds.length
      ? await Promise.all([
          db
            .select({
              userId: departmentMembers.userId,
              departmentId: departmentMembers.departmentId,
            })
            .from(departmentMembers)
            .where(inArray(departmentMembers.userId, userIds)),
          db
            .select({
              userId: boardMembers.userId,
              boardId: boardMembers.boardId,
            })
            .from(boardMembers)
            .where(inArray(boardMembers.userId, userIds)),
        ])
      : [[], []];
    return {
      users: baseUsers.map((item) => {
        const departmentIds = departmentLinks
          .filter((link) => link.userId === item.id)
          .map((link) => link.departmentId);
        const boardIds = boardLinks
          .filter((link) => link.userId === item.id)
          .map((link) => link.boardId);
        return {
          ...item,
          departmentIds,
          boardIds,
          departmentCount: departmentIds.length,
          boardCount: boardIds.length,
        };
      }),
    };
  });
  app.post('/admin/users', async (r, reply) => {
    const u = await user(r, reply),
      p = adminUserCreateInput.safeParse(r.body);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (u.role === 'admin' && p.data.role !== 'user')
      return reply.code(403).send({ code: 'FORBIDDEN' });
    const created = {
      id: crypto.randomUUID(),
      email: normalizeEmail(p.data.email),
      passwordHash: await hashPassword(p.data.password),
      role: p.data.role,
      workEmail: normalizeEmail(p.data.email),
      firstName: p.data.firstName,
      lastName: p.data.lastName,
    };
    try {
      await db.insert(users).values(created);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === '23505'
      )
        return reply.code(409).send({ code: 'EMAIL_TAKEN' });
      throw error;
    }
    return reply.code(201).send({
      user: {
        id: created.id,
        email: created.email,
        role: created.role,
        firstName: created.firstName,
        lastName: created.lastName,
        archivedAt: null,
      },
    });
  });
  app.patch('/admin/users/:userId', async (r, reply) => {
    const u = await user(r, reply),
      targetId = id(r, 'userId'),
      p = adminUserPatchInput.safeParse(r.body);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!targetId.success)
      return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (targetId.data === u.id && p.data.role !== undefined)
      return reply.code(409).send({ code: 'SELF_ROLE_CHANGE' });
    if (p.data.role !== undefined && !canChangeAccountRole(u.role))
      return reply.code(403).send({ code: 'FORBIDDEN' });
    const passwordHash = p.data.password
      ? await hashPassword(p.data.password)
      : undefined;
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
      );
      const target = (
        await tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, targetId.data), isNull(users.archivedAt)))
          .limit(1)
      )[0];
      if (!target) return 'USER_NOT_FOUND';
      if (!canManageAccount(u.role, target.role)) return 'FORBIDDEN';
      if (
        target.role === 'superadmin' &&
        p.data.role !== undefined &&
        p.data.role !== 'superadmin'
      ) {
        const activeSuperadmins = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'superadmin'), isNull(users.archivedAt)))
          .limit(2);
        if (activeSuperadmins.length <= 1) return 'LAST_SUPERADMIN';
      }
      await tx
        .update(users)
        .set({
          ...(p.data.role === undefined ? {} : { role: p.data.role }),
          ...(passwordHash === undefined ? {} : { passwordHash }),
          ...(p.data.firstName === undefined
            ? {}
            : { firstName: p.data.firstName }),
          ...(p.data.lastName === undefined
            ? {}
            : { lastName: p.data.lastName }),
        })
        .where(eq(users.id, targetId.data));
      if (passwordHash !== undefined)
        await tx.delete(sessions).where(eq(sessions.userId, targetId.data));
      if (p.data.role !== undefined && p.data.role !== target.role) {
        await tx
          .delete(boardMembers)
          .where(eq(boardMembers.userId, targetId.data));
        await tx
          .delete(departmentMembers)
          .where(eq(departmentMembers.userId, targetId.data));
        if (p.data.role === 'user') {
          const now = new Date();
          await tx.execute(sql`
            insert into task_events(id, task_id, actor_id, type, from_assignee_id)
            select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
            from tasks t where t.assignee_id = ${targetId.data}
          `);
          await tx
            .update(tasks)
            .set({ assigneeId: null, updatedAt: now })
            .where(eq(tasks.assigneeId, targetId.data));
          await tx
            .update(timeEntries)
            .set({ stoppedAt: now })
            .where(
              and(
                eq(timeEntries.userId, targetId.data),
                isNull(timeEntries.stoppedAt),
              ),
            );
        }
      }
      return 'OK';
    });
    if (result === 'USER_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'FORBIDDEN') return reply.code(403).send({ code: result });
    if (result === 'LAST_SUPERADMIN')
      return reply.code(409).send({ code: result });
    return reply.code(204).send();
  });
  app.delete('/admin/users/:userId', async (r, reply) => {
    const u = await user(r, reply),
      targetId = id(r, 'userId');
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!targetId.success)
      return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    if (targetId.data === u.id)
      return reply.code(409).send({ code: 'SELF_ARCHIVE' });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
      );
      const target = (
        await tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, targetId.data), isNull(users.archivedAt)))
          .limit(1)
      )[0];
      if (!target) return 'USER_NOT_FOUND';
      if (!canManageAccount(u.role, target.role)) return 'FORBIDDEN';
      if (target.role === 'superadmin') {
        const activeSuperadmins = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'superadmin'), isNull(users.archivedAt)))
          .limit(2);
        if (activeSuperadmins.length <= 1) return 'LAST_SUPERADMIN';
      }
      const now = new Date();
      await tx
        .update(timeEntries)
        .set({ stoppedAt: now })
        .where(
          and(
            eq(timeEntries.userId, targetId.data),
            isNull(timeEntries.stoppedAt),
          ),
        );
      await tx.delete(sessions).where(eq(sessions.userId, targetId.data));
      await tx
        .delete(boardMembers)
        .where(eq(boardMembers.userId, targetId.data));
      await tx
        .delete(departmentMembers)
        .where(eq(departmentMembers.userId, targetId.data));
      await tx.execute(sql`
        insert into task_events(id, task_id, actor_id, type, from_assignee_id)
        select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
        from tasks t where t.assignee_id = ${targetId.data}
      `);
      await tx
        .update(tasks)
        .set({ assigneeId: null, updatedAt: now })
        .where(eq(tasks.assigneeId, targetId.data));
      await tx
        .update(users)
        .set({ archivedAt: now })
        .where(eq(users.id, targetId.data));
      return 'OK';
    });
    if (result === 'USER_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'FORBIDDEN') return reply.code(403).send({ code: result });
    if (result === 'LAST_SUPERADMIN')
      return reply.code(409).send({ code: result });
    return reply.code(204).send();
  });
  app.post('/admin/users/:userId/restore', async (r, reply) => {
    const u = await user(r, reply),
      targetId = id(r, 'userId');
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!targetId.success)
      return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
      );
      const target = (
        await tx
          .select({ role: users.role })
          .from(users)
          .where(and(eq(users.id, targetId.data), isNotNull(users.archivedAt)))
          .limit(1)
      )[0];
      if (!target) return 'USER_NOT_FOUND';
      if (!canManageAccount(u.role, target.role)) return 'FORBIDDEN';
      await tx
        .update(users)
        .set({ archivedAt: null })
        .where(eq(users.id, targetId.data));
      return 'OK';
    });
    if (result === 'USER_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'FORBIDDEN') return reply.code(403).send({ code: result });
    return reply.code(204).send();
  });
  app.put('/admin/users/:userId/access', async (r, reply) => {
    const u = await user(r, reply),
      targetId = id(r, 'userId'),
      p = accessInput.safeParse(r.body);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!targetId.success)
      return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
      );
      const target = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, targetId.data),
              eq(users.role, 'user'),
              isNull(users.archivedAt),
            ),
          )
          .limit(1)
      )[0];
      if (!target) return 'USER_NOT_FOUND';
      const existingDepartments = p.data.departmentIds.length
        ? await tx
            .select({ id: departments.id })
            .from(departments)
            .where(inArray(departments.id, p.data.departmentIds))
        : [];
      const existingBoards = p.data.boardIds.length
        ? await tx
            .select({ id: boards.id })
            .from(boards)
            .where(inArray(boards.id, p.data.boardIds))
        : [];
      if (
        existingDepartments.length !== p.data.departmentIds.length ||
        existingBoards.length !== p.data.boardIds.length
      )
        return 'ASSIGNMENT_TARGET_NOT_FOUND';
      await tx
        .delete(boardMembers)
        .where(eq(boardMembers.userId, targetId.data));
      await tx
        .delete(departmentMembers)
        .where(eq(departmentMembers.userId, targetId.data));
      if (p.data.departmentIds.length)
        await tx.insert(departmentMembers).values(
          p.data.departmentIds.map((departmentId) => ({
            departmentId,
            userId: targetId.data,
          })),
        );
      if (p.data.boardIds.length)
        await tx.insert(boardMembers).values(
          p.data.boardIds.map((boardId) => ({
            boardId,
            userId: targetId.data,
            role: 'member' as const,
          })),
        );
      const now = new Date();
      await tx.execute(sql`
        insert into task_events(id, task_id, actor_id, type, from_assignee_id)
        select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
        from tasks t
        where t.assignee_id = ${targetId.data}
          and not kanban_has_board_access(t.board_id, ${targetId.data})
      `);
      await tx.execute(sql`update tasks set assignee_id=null, updated_at=${now}
        where assignee_id=${targetId.data} and not kanban_has_board_access(board_id, ${targetId.data})`);
      await tx.execute(sql`update time_entries set stopped_at=${now}
        where user_id=${targetId.data} and stopped_at is null and task_id in (
          select id from tasks where not kanban_has_board_access(board_id, ${targetId.data})
        )`);
      return 'OK';
    });
    if (result === 'USER_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'ASSIGNMENT_TARGET_NOT_FOUND')
      return reply.code(404).send({ code: result });
    return reply.code(204).send();
  });
  app.patch('/boards/:boardId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = boardPatchInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await member(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const currentDepartment = (
      await db
        .select({ departmentId: boards.departmentId })
        .from(boards)
        .where(eq(boards.id, b.data))
        .limit(1)
    )[0]?.departmentId;
    const targetDepartment = p.data.departmentId,
      changingDepartment =
        targetDepartment !== undefined &&
        targetDepartment !== currentDepartment;
    if (
      targetDepartment &&
      changingDepartment &&
      !(
        await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, targetDepartment))
          .limit(1)
      )[0]
    )
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    if (
      targetDepartment &&
      changingDepartment &&
      !(await assignedToDepartment(targetDepartment, u))
    )
      return reply.code(404).send({ code: 'DEPARTMENT_NOT_FOUND' });
    await db.transaction(async (tx) => {
      await tx.update(boards).set(p.data).where(eq(boards.id, b.data));
      if (changingDepartment) {
        const now = new Date();
        await tx.execute(sql`
          insert into task_events(id, task_id, actor_id, type, from_assignee_id)
          select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
          from tasks t
          where t.board_id = ${b.data} and t.assignee_id is not null
            and not kanban_has_board_access(${b.data}, t.assignee_id)
        `);
        await tx.execute(sql`update tasks set assignee_id=null, updated_at=${now}
          where board_id=${b.data} and assignee_id is not null and not kanban_has_board_access(${b.data}, assignee_id)`);
        await tx.execute(sql`update time_entries set stopped_at=${now}
          where stopped_at is null and task_id in (select id from tasks where board_id=${b.data})
            and not kanban_has_board_access(${b.data}, user_id)`);
      }
    });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/archive', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await member(b.data, u.id)))
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
    if (!b.success || !(await member(b.data, u.id, true)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    await db
      .update(boards)
      .set({ archivedAt: null })
      .where(eq(boards.id, b.data));
    return reply.code(204).send();
  });
  app.delete('/boards/:boardId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await member(b.data, u.id, true)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const result = await db.transaction(async (tx) => {
      const board = await tx.execute(
        sql`select archived_at from boards where id = ${b.data} for update`,
      );
      if (!board.rows[0]) return 'BOARD_NOT_FOUND';
      if (!board.rows[0].archived_at) return 'BOARD_NOT_ARCHIVED';
      const existingTask = (
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.boardId, b.data))
          .limit(1)
      )[0];
      if (existingTask) return 'BOARD_NOT_EMPTY';
      await tx.delete(boards).where(eq(boards.id, b.data));
      return 'OK';
    });
    if (result === 'BOARD_NOT_FOUND')
      return reply.code(404).send({ code: result });
    if (result === 'BOARD_NOT_ARCHIVED' || result === 'BOARD_NOT_EMPTY')
      return reply.code(409).send({ code: result });
    return reply.code(204).send();
  });
  app.get('/boards/:boardId/members', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId');
    if (!u) return;
    if (!b.success || !(await boardOr404(b.data, u.id, reply))) return;
    return {
      members: (
        await pool.query(
          `select u.id,u.email,u.first_name as "firstName",u.last_name as "lastName",'member'::text as role,u.role as "accountRole",u.archived_at as "archivedAt",
          case when u.role in ('superadmin','admin') then 'global'
               when bm.user_id is not null and dm.user_id is not null then 'both'
               when bm.user_id is not null then 'board' else 'department' end as "accessSource"
         from users u
         left join board_members bm on bm.board_id=$1 and bm.user_id=u.id
         left join department_members dm on dm.department_id=(select department_id from boards where id=$1) and dm.user_id=u.id
         where u.archived_at is null and (u.role in ('superadmin','admin') or bm.user_id is not null or dm.user_id is not null)
         order by u.last_name nulls last,u.first_name nulls last,u.email,u.id`,
          [b.data],
        )
      ).rows,
    };
  });
  app.post('/boards/:boardId/members', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = z.object({ userId: z.string().uuid() }).strict().safeParse(r.body);
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!b.success || !(await member(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    if (!p.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    try {
      const added = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('minimal-kanban-active-admins'))`,
        );
        const target = (
          await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.id, p.data.userId),
                eq(users.role, 'user'),
                isNull(users.archivedAt),
              ),
            )
            .limit(1)
        )[0];
        if (!target) return false;
        await tx
          .insert(boardMembers)
          .values({ boardId: b.data, userId: p.data.userId, role: 'member' });
        return true;
      });
      if (!added) return reply.code(404).send({ code: 'USER_NOT_FOUND' });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === '23505'
      )
        return reply.code(409).send({ code: 'ALREADY_MEMBER' });
      throw error;
    }
    return reply.code(201).send();
  });
  app.delete('/boards/:boardId/members/:userId', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      target = id(r, 'userId');
    if (!u) return;
    if (!isElevated(u.role)) return reply.code(403).send({ code: 'FORBIDDEN' });
    if (!b.success || !target.success || !(await member(b.data, u.id)))
      return reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
    const removed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from boards where id = ${b.data} for update`,
      );
      const membership = await tx
        .delete(boardMembers)
        .where(
          and(
            eq(boardMembers.boardId, b.data),
            eq(boardMembers.userId, target.data),
          ),
        )
        .returning({ userId: boardMembers.userId });
      if (!membership[0]) return 'NOT_FOUND';
      const now = new Date();
      await tx.execute(sql`
        insert into task_events(id, task_id, actor_id, type, from_assignee_id)
        select gen_random_uuid(), t.id, ${u.id}, 'assignee_changed', t.assignee_id
        from tasks t
        where t.board_id = ${b.data} and t.assignee_id = ${target.data}
          and not kanban_has_board_access(${b.data}, ${target.data})
      `);
      await tx.execute(sql`update tasks set assignee_id=null, updated_at=${now}
        where board_id=${b.data} and assignee_id=${target.data}
          and not kanban_has_board_access(${b.data}, ${target.data})`);
      await tx.execute(sql`update time_entries set stopped_at=${now}
        where user_id=${target.data} and stopped_at is null
          and task_id in (select id from tasks where board_id=${b.data})
          and not kanban_has_board_access(${b.data}, ${target.data})`);
      return 'OK';
    });
    if (removed === 'NOT_FOUND')
      return reply.code(404).send({ code: 'MEMBER_NOT_FOUND' });
    return reply.code(204).send();
  });
  app.post('/boards/:boardId/columns', async (r, reply) => {
    const u = await user(r, reply),
      b = id(r, 'boardId'),
      p = boardInput.safeParse(r.body);
    if (!u) return;
    if (!b.success || !(await member(b.data, u.id)))
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
    if (!b.success || !c.success || !(await member(b.data, u.id)))
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
    if (!b.success || !c.success || !(await member(b.data, u.id)))
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
    if (!b.success || !(await member(b.data, u.id)))
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
    if (!b.success || !c.success || !(await member(b.data, u.id)))
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
    if (!u) return null;
    if (!b.success || !(await member(b.data, u.id))) {
      reply.code(404).send({ code: 'BOARD_NOT_FOUND' });
      return null;
    }
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
    if (!entry || !entry.stoppedAt || !(await owned(entry.taskId, u.id)))
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
      'select a.file_name,a.mime_type,a.storage_path from attachments a join tasks t on t.id=a.task_id where a.id=$1 and kanban_has_board_access(t.board_id,$2)',
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
    await seedSuperadmin();
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
