import {
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  numeric,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const userRole = pgEnum('user_role', ['admin', 'user']);
export const boardRole = pgEnum('board_role', ['admin', 'member']);
export const taskEventType = pgEnum('task_event_type', [
  'created',
  'column_changed',
  'assignee_changed',
]);
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('departments_name_ci_idx').on(sql`lower(${t.name})`),
    check(
      'departments_name_check',
      sql`${t.name} = btrim(${t.name}) AND char_length(${t.name}) BETWEEN 1 AND 120`,
    ),
  ],
);
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('boards_department_idx').on(t.departmentId)],
);
export const boardMembers = pgTable(
  'board_members',
  {
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: boardRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('board_members_user_idx').on(t.userId, t.boardId),
  ],
);
export const columns = pgTable(
  'columns',
  {
    id: uuid('id').primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: numeric('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('columns_board_position_idx').on(t.boardId, t.position),
    check('columns_position_positive', sql`${t.position} > 0`),
  ],
);
export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('topics_board_name_active_idx').on(t.boardId, t.name)],
);
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('labels_board_name_active_idx').on(t.boardId, t.name)],
);
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id')
      .notNull()
      .references(() => columns.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    assigneeName: text('assignee_name'),
    topicId: uuid('topic_id').references(() => topics.id, {
      onDelete: 'restrict',
    }),
    color: text('color'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    estimatedMinutes: integer('estimated_minutes'),
    position: numeric('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_board_active_idx').on(t.boardId, t.archivedAt),
    index('tasks_column_position_idx').on(t.columnId, t.archivedAt, t.position),
    index('tasks_assignee_idx').on(t.boardId, t.assigneeId),
    check(
      'tasks_assignee_shape_check',
      sql`NOT (${t.assigneeId} IS NOT NULL AND ${t.assigneeName} IS NOT NULL) AND (${t.assigneeName} IS NULL OR kanban_valid_assignee_name(${t.assigneeName}))`,
    ),
    check('tasks_estimated_minutes_check', sql`${t.estimatedMinutes} >= 0`),
    check('tasks_position_positive', sql`${t.position} > 0`),
  ],
);
export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: taskEventType('type').notNull(),
    fromColumnId: uuid('from_column_id'),
    fromColumnName: text('from_column_name'),
    toColumnId: uuid('to_column_id'),
    toColumnName: text('to_column_name'),
    fromAssigneeId: uuid('from_assignee_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    fromAssigneeName: text('from_assignee_name'),
    toAssigneeId: uuid('to_assignee_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    toAssigneeName: text('to_assignee_name'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('task_events_task_created_idx').on(t.taskId, t.createdAt),
    check(
      'task_events_assignee_names_check',
      sql`(${t.fromAssigneeName} IS NULL OR kanban_valid_assignee_name(${t.fromAssigneeName})) AND (${t.toAssigneeName} IS NULL OR kanban_valid_assignee_name(${t.toAssigneeName}))`,
    ),
    check(
      'task_events_shape_check',
      sql`(
        (${t.type} = 'created' AND ${t.fromColumnId} IS NULL AND ${t.fromColumnName} IS NULL AND ${t.toColumnId} IS NULL AND ${t.toColumnName} IS NULL AND ${t.fromAssigneeId} IS NULL AND ${t.fromAssigneeName} IS NULL AND ${t.toAssigneeId} IS NULL AND ${t.toAssigneeName} IS NULL)
        OR
        (${t.type} = 'column_changed' AND ${t.fromColumnId} IS NOT NULL AND ${t.fromColumnName} IS NOT NULL AND ${t.toColumnId} IS NOT NULL AND ${t.toColumnName} IS NOT NULL AND ${t.fromColumnId} <> ${t.toColumnId} AND ${t.fromAssigneeId} IS NULL AND ${t.fromAssigneeName} IS NULL AND ${t.toAssigneeId} IS NULL AND ${t.toAssigneeName} IS NULL)
        OR
        (${t.type} = 'assignee_changed' AND ${t.fromColumnId} IS NULL AND ${t.fromColumnName} IS NULL AND ${t.toColumnId} IS NULL AND ${t.toColumnName} IS NULL AND NOT (${t.fromAssigneeId} IS NOT NULL AND ${t.fromAssigneeName} IS NOT NULL) AND NOT (${t.toAssigneeId} IS NOT NULL AND ${t.toAssigneeName} IS NOT NULL) AND ROW(${t.fromAssigneeId}, ${t.fromAssigneeName}) IS DISTINCT FROM ROW(${t.toAssigneeId}, ${t.toAssigneeName}))
      )`,
    ),
  ],
);
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storagePath: text('storage_path').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('attachments_task_idx').on(t.taskId, t.createdAt),
    check(
      'attachments_check',
      sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 10485760`,
    ),
  ],
);
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('time_entries_task_started_idx').on(t.taskId, t.startedAt),
    index('time_entries_user_started_idx').on(t.userId, t.startedAt),
    uniqueIndex('time_entries_one_active_per_user_idx')
      .on(t.userId)
      .where(sql`${t.stoppedAt} IS NULL`),
    check(
      'time_entries_check',
      sql`${t.stoppedAt} IS NULL OR ${t.stoppedAt} >= ${t.startedAt}`,
    ),
  ],
);
export const timeEntryCorrections = pgTable(
  'time_entry_corrections',
  {
    id: uuid('id').primaryKey(),
    timeEntryId: uuid('time_entry_id')
      .notNull()
      .references(() => timeEntries.id, { onDelete: 'restrict' }),
    correctedBy: uuid('corrected_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    previousStartedAt: timestamp('previous_started_at', {
      withTimezone: true,
    }).notNull(),
    previousStoppedAt: timestamp('previous_stopped_at', {
      withTimezone: true,
    }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('time_entry_corrections_entry_idx').on(t.timeEntryId, t.createdAt),
    check(
      'time_entry_corrections_check',
      sql`${t.stoppedAt} >= ${t.startedAt}`,
    ),
  ],
);
