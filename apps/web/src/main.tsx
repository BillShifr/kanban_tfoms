import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  ColorInput,
  Combobox,
  Drawer as MantineDrawer,
  FileInput,
  Group,
  MantineProvider,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Popover,
  Select,
  Stack,
  Skeleton,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  createTheme,
  useCombobox,
  useMantineColorScheme,
} from '@mantine/core';
import { DateInput, DatesProvider } from '@mantine/dates';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Archive,
  Bell,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Clock3,
  Columns3,
  FileUp,
  Filter,
  GripVertical,
  History as HistoryIcon,
  KeyRound,
  Menu as MenuIcon,
  LogOut,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sun,
  SunMoon,
  Timer,
  TimerReset,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import 'dayjs/locale/ru';
import './styles.css';
type AccountRole = 'superadmin' | 'admin' | 'user';
type User = {
  id: string;
  email: string;
  workEmail?: string | null;
  role: AccountRole;
  firstName?: string | null;
  lastName?: string | null;
};
type AdminUser = User & {
  createdAt: string;
  archivedAt?: string | null;
  departmentIds?: string[];
  boardIds?: string[];
  departmentCount?: number;
  boardCount?: number;
};
type Board = {
  id: string;
  name: string;
  departmentId?: string | null;
  archivedAt?: string | null;
};
type Department = { id: string; name: string; canManage?: boolean };
type Person = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string;
  role?: 'admin' | 'member';
  accountRole?: AccountRole;
  accessSource?: 'board' | 'department' | 'both' | 'global';
  archivedAt?: string | null;
};
type Tag = { id: string; name: string; color?: string };
type Attachment = {
  id: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
};
type Task = {
  id: string;
  columnId: string;
  title: string;
  description: string;
  authorId?: string;
  author?: Person;
  assigneeId?: string | null;
  assigneeName?: string | null;
  topicId?: string | null;
  labelIds?: string[];
  labels?: Tag[];
  dueAt?: string | null;
  estimatedMinutes?: number | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  activeTimer?: { id: string; startedAt: string } | null;
  timeSeconds?: number;
  attachments?: Attachment[];
};
type Column = { id: string; name: string; tasks: Task[] };
type ArchivedColumn = { id: string; name: string; archivedAt: string };
type Payload = {
  board: Board;
  columns: Column[];
  members?: Person[];
  topics?: Tag[];
  labels?: Tag[];
};
type Fail = { code?: string; message?: string };
type TaskEvent = {
  id: string;
  type: 'created' | 'column_changed' | 'assignee_changed' | 'completed';
  createdAt: string;
  actor: Person | null;
  fromColumn: Tag | null;
  toColumn: Tag | null;
  fromAssignee:
    | Pick<Person, 'id' | 'email' | 'firstName' | 'lastName' | 'name'>
    | { name: string }
    | null;
  toAssignee:
    | Pick<Person, 'id' | 'email' | 'firstName' | 'lastName' | 'name'>
    | { name: string }
    | null;
};
const taskCollisionDetection: CollisionDetection = (args) =>
  closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => container.id !== args.active.id,
    ),
  });
const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily:
    'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  components: {
    Button: { defaultProps: { size: 'sm' } },
    TextInput: { defaultProps: { size: 'sm' } },
    PasswordInput: { defaultProps: { size: 'sm' } },
    Textarea: { defaultProps: { size: 'sm' } },
    Select: {
      defaultProps: {
        size: 'sm',
        checkIconPosition: 'right',
        openOnFocus: false,
      },
    },
    MultiSelect: { defaultProps: { size: 'sm', checkIconPosition: 'right' } },
    NumberInput: { defaultProps: { size: 'sm', hideControls: true } },
  },
});
const ru: Record<string, string> = {
  INVALID_CREDENTIALS: 'Неверный email или пароль',
  UNAUTHENTICATED: 'Войдите в систему',
  VALIDATION_ERROR: 'Проверьте введённые данные',
  FORBIDDEN: 'Недостаточно прав',
  ACTIVE_TIMER_EXISTS: 'Сначала остановите текущий таймер',
  TIMER_ALREADY_RUNNING: 'Сначала остановите текущий таймер',
  TASK_NOT_FOUND: 'Задача не найдена',
  COLUMN_HAS_TASKS: 'Сначала переместите из колонки все задачи',
  LAST_COLUMN: 'На доске должна остаться хотя бы одна колонка',
  DEPARTMENT_NAME_TAKEN: 'Отдел с таким названием уже существует',
  DEPARTMENT_NOT_FOUND: 'Отдел не найден',
  EMAIL_TAKEN: 'Пользователь с таким email уже существует',
  ALREADY_MEMBER: 'Пользователь уже добавлен на эту доску',
  USER_NOT_FOUND: 'Пользователь не найден',
  ASSIGNMENT_TARGET_NOT_FOUND: 'Выбранный отдел или доска не найдены',
  LAST_SUPERADMIN: 'В системе должен остаться хотя бы один суперадминистратор',
  SELF_ROLE_CHANGE: 'Нельзя изменить собственную роль',
  SELF_DELETE: 'Нельзя отключить свою учётную запись',
  SELF_ARCHIVE: 'Нельзя отключить свою учётную запись',
  DEPARTMENT_HAS_BOARDS:
    'Сначала перенесите или удалите все доски отдела, включая архивные',
  BOARD_NOT_ARCHIVED: 'Сначала архивируйте доску',
  BOARD_NOT_EMPTY:
    'Доску с задачами нельзя удалить навсегда — оставьте её в архиве',
  TASK_ALREADY_COMPLETED: 'Задача уже отмечена выполненной',
};
const roleLabel: Record<AccountRole, string> = {
  user: 'Пользователь',
  admin: 'Администратор',
  superadmin: 'Суперадминистратор',
};
const accessSourceLabel: Record<NonNullable<Person['accessSource']>, string> = {
  board: 'Доступ выдан к доске',
  department: 'Доступ через отдел',
  both: 'Доступ к доске и через отдел',
  global: 'Глобальный доступ',
};
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const form = init.body instanceof FormData,
    hasBody = init.body !== undefined,
    r = await fetch('/api' + path, {
      credentials: 'include',
      ...init,
      headers: {
        ...(form || !hasBody ? {} : { 'content-type': 'application/json' }),
        ...(init.headers ?? {}),
      },
    }),
    body = await r.text();
  if (!r.ok) {
    let x: Fail = {};
    if (body) {
      try {
        x = JSON.parse(body) as Fail;
      } catch {
        x.message = r.statusText;
      }
    } else {
      x.message = r.statusText;
    }
    throw x;
  }
  if (!body) return undefined as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('Сервер вернул некорректный ответ');
  }
}
function err(e: unknown) {
  return typeof e === 'object' && e !== null
    ? (ru[String((e as Fail).code)] ??
        (e as Fail).message ??
        'Не удалось выполнить действие')
    : 'Не удалось выполнить действие';
}
function date(s?: string | null) {
  return s?.slice(0, 10) ?? '';
}
function parseRussianDateInput(value: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText),
    month = Number(monthText),
    year = Number(yearText),
    parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
    ? parsed
    : null;
}
function duration(sec = 0) {
  const m = Math.floor(sec / 60);
  return m > 59 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
}
function personLabel(
  person:
    | Partial<Pick<Person, 'email' | 'firstName' | 'lastName' | 'name'>>
    | null
    | undefined,
) {
  const fullName = [person?.lastName, person?.firstName]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return fullName || person?.name || person?.email || 'Пользователь';
}
function personOptionLabel(
  person: Pick<Person, 'email' | 'firstName' | 'lastName'>,
) {
  const label = personLabel(person);
  return label === person.email ? label : `${label} · ${person.email}`;
}
const userAssigneeKey = (id: string) => `user:${id}`,
  textAssigneeKey = (name: string) => `text:${name}`;
function taskAssigneeKey(task: Task) {
  if (task.assigneeId) return userAssigneeKey(task.assigneeId);
  return task.assigneeName ? textAssigneeKey(task.assigneeName) : '';
}
function AssigneeCombobox({
  members,
  value,
  onChange,
}: {
  members: Person[];
  value: string;
  onChange: (value: string) => void;
}) {
  const combobox = useCombobox({
      onDropdownClose: () => combobox.resetSelectedOption(),
      onDropdownOpen: () => combobox.selectFirstOption(),
    }),
    selectedMember = value.startsWith('user:')
      ? members.find((member) => member.id === value.slice(5))
      : undefined,
    selectedLabel = value.startsWith('text:')
      ? value.slice(5)
      : selectedMember
        ? personLabel(selectedMember)
        : '',
    [search, setSearch] = useState(selectedLabel),
    normalizedSearch = search.trim().toLocaleLowerCase('ru-RU'),
    visibleMembers = members.filter((member) =>
      `${personOptionLabel(member)} ${member.name ?? ''}`
        .toLocaleLowerCase('ru-RU')
        .includes(normalizedSearch),
    ),
    exactMember = members.some(
      (member) =>
        personLabel(member).toLocaleLowerCase('ru-RU') === normalizedSearch ||
        personOptionLabel(member).toLocaleLowerCase('ru-RU') ===
          normalizedSearch,
    ),
    canUseText = search.trim().length > 0 && !exactMember;
  useEffect(() => setSearch(selectedLabel), [selectedLabel]);
  const choose = (next: string) => {
    const resolved = next === 'none:' ? '' : next;
    onChange(resolved);
    if (resolved.startsWith('user:')) {
      const member = members.find((item) => item.id === resolved.slice(5));
      setSearch(member ? personLabel(member) : '');
    } else setSearch(resolved.startsWith('text:') ? resolved.slice(5) : '');
    combobox.closeDropdown();
  };
  return (
    <Combobox store={combobox} onOptionSubmit={choose} withinPortal>
      <Combobox.Target>
        <TextInput
          label="Исполнитель"
          placeholder="Не назначен"
          value={search}
          onFocus={(event) => {
            event.currentTarget.select();
            combobox.openDropdown();
          }}
          onClick={() => combobox.openDropdown()}
          onBlur={() => {
            combobox.closeDropdown();
            setSearch(selectedLabel);
          }}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            combobox.openDropdown();
            combobox.selectFirstOption();
          }}
          maxLength={120}
          rightSection={<Combobox.Chevron />}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          <Combobox.Option value="none:" active={!value}>
            Не назначен
          </Combobox.Option>
          {visibleMembers.length > 0 && (
            <Combobox.Group label="Участники доски">
              {visibleMembers.map((member) => (
                <Combobox.Option
                  value={userAssigneeKey(member.id)}
                  key={member.id}
                  active={value === userAssigneeKey(member.id)}
                >
                  {personOptionLabel(member)}
                </Combobox.Option>
              ))}
            </Combobox.Group>
          )}
          {canUseText && (
            <Combobox.Group label="Произвольное имя">
              <Combobox.Option value={textAssigneeKey(search.trim())}>
                Использовать «{search.trim()}»
              </Combobox.Option>
            </Combobox.Group>
          )}
          {visibleMembers.length === 0 && !canUseText && (
            <Combobox.Empty>Ничего не найдено</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
function Login({ done }: { done: (u: User) => void }) {
  const [email, setEmail] = useState('admin@example.com'),
    [password, setPassword] = useState('change-me-now'),
    [error, setError] = useState('');
  return (
    <main className="auth">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            done(
              (
                await api<{ user: User }>('/auth/sign-in', {
                  method: 'POST',
                  body: JSON.stringify({ email, password }),
                })
              ).user,
            );
          } catch (x) {
            setError(err(x));
          }
        }}
      >
        <div className="auth-brand">
          <img
            src="/tfoms-yugra-logo.png"
            alt="Логотип ТФОМС Югры"
            width="64"
            height="56"
          />
          <div>
            <span>ТФОМС Югры</span>
            <h1>Канбан</h1>
          </div>
        </div>
        <p>Вход в командную доску</p>
        <TextInput
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
        <PasswordInput
          label="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p role="alert">{error}</p>}
        <Button type="submit">Войти</Button>
      </form>
    </main>
  );
}
function UserMenu({
  user,
  logout,
  openArchivedBoards,
  openUsers,
  openProfile,
}: {
  user: User;
  logout: () => void;
  openArchivedBoards: () => void;
  openUsers: () => void;
  openProfile: () => void;
}) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const themes = [
    { value: 'auto', label: 'Системное', icon: SunMoon },
    { value: 'light', label: 'Светлое', icon: Sun },
    { value: 'dark', label: 'Тёмное', icon: Moon },
  ] as const;
  return (
    <Menu position="bottom-end" shadow="md" width={220}>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          className="user-menu-trigger"
          rightSection={<ChevronDown size={15} />}
        >
          {personLabel(user)}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Оформление</Menu.Label>
        {themes.map((item) => {
          const Icon = item.icon;
          return (
            <Menu.Item
              key={item.value}
              leftSection={<Icon size={16} />}
              rightSection={
                colorScheme === item.value ? <Check size={15} /> : null
              }
              onClick={() => setColorScheme(item.value)}
            >
              {item.label}
            </Menu.Item>
          );
        })}
        <Menu.Divider />
        <Menu.Item leftSection={<UserRound size={16} />} onClick={openProfile}>
          Рабочая почта
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<Archive size={16} />}
          onClick={openArchivedBoards}
        >
          Архив досок
        </Menu.Item>
        {user.role !== 'user' && (
          <>
            <Menu.Divider />
            <Menu.Label>Администрирование</Menu.Label>
            <Menu.Item
              leftSection={<UsersRound size={16} />}
              onClick={openUsers}
            >
              Пользователи и права
            </Menu.Item>
          </>
        )}
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<LogOut size={16} />}
          onClick={logout}
        >
          Выйти
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
function ProfileDrawer({
  user,
  updateCurrentUser,
  close,
}: {
  user: User;
  updateCurrentUser: (user: User) => void;
  close: () => void;
}) {
  const [workEmail, setWorkEmail] = useState(user.workEmail ?? user.email),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={440}
      title="Настройки профиля"
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <form
        className="user-action-panel"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void api<{ user: User }>('/auth/me', {
            method: 'PATCH',
            body: JSON.stringify({ workEmail }),
          })
            .then((result) => {
              updateCurrentUser(result.user);
              close();
            })
            .catch((reason: unknown) => setError(err(reason)))
            .finally(() => setBusy(false));
        }}
      >
        <Text c="dimmed" size="sm">
          На этот адрес придёт письмо, когда созданная вами задача будет
          отмечена выполненной.
        </Text>
        <TextInput
          label="Рабочая почта"
          type="email"
          value={workEmail}
          onChange={(event) => setWorkEmail(event.currentTarget.value)}
          required
          autoFocus
        />
        <Group justify="flex-end">
          <Button type="button" variant="subtle" color="gray" onClick={close}>
            Отмена
          </Button>
          <Button type="submit" loading={busy}>
            Сохранить
          </Button>
        </Group>
        {error && <p role="alert">{error}</p>}
      </form>
    </MantineDrawer>
  );
}
type Notification = {
  id: string;
  type: 'task_assigned';
  taskId: string;
  boardId: string;
  taskTitle: string;
  readAt: string | null;
  createdAt: string;
  actor: Pick<Person, 'email' | 'firstName' | 'lastName'>;
};
function NotificationBell() {
  const queryClient = useQueryClient();
  const notifications = useQuery<{
    notifications: Notification[];
    unreadCount: number;
  }>({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications'),
    refetchInterval: 30_000,
  });
  const markRead = (notification: Notification) => {
    if (notification.readAt) return;
    void api(`/notifications/${notification.id}/read`, { method: 'POST' }).then(
      () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    );
  };
  const items = notifications.data?.notifications ?? [];
  return (
    <Popover width={360} position="bottom-end" shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          aria-label={`Уведомления${
            notifications.data?.unreadCount
              ? `: ${notifications.data.unreadCount} непрочитанных`
              : ''
          }`}
        >
          <Bell size={19} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text fw={700}>Уведомления</Text>
          {items.length === 0 ? (
            <Text c="dimmed" size="sm">
              Новых уведомлений нет
            </Text>
          ) : (
            items.map((notification) => (
              <Button
                key={notification.id}
                variant={notification.readAt ? 'subtle' : 'light'}
                color="gray"
                justify="flex-start"
                onClick={() => markRead(notification)}
              >
                {personLabel(notification.actor)} назначил(а) вам задачу «
                {notification.taskTitle}»
              </Button>
            ))
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
function AdminUsersDrawer({
  currentUser,
  departments,
  boards,
  updateCurrentUser,
  close,
}: {
  currentUser: User;
  departments: Department[];
  boards: Board[];
  updateCurrentUser: (user: User) => void;
  close: () => void;
}) {
  const [status, setStatus] = useState<'active' | 'archived'>('active'),
    [email, setEmail] = useState(''),
    [lastName, setLastName] = useState(''),
    [firstName, setFirstName] = useState(''),
    [password, setPassword] = useState(''),
    [role, setRole] = useState<AccountRole>('user'),
    [passwordTarget, setPasswordTarget] = useState<AdminUser | null>(null),
    [newPassword, setNewPassword] = useState(''),
    [profileTarget, setProfileTarget] = useState<AdminUser | null>(null),
    [profileLastName, setProfileLastName] = useState(''),
    [profileFirstName, setProfileFirstName] = useState(''),
    [archiveTarget, setArchiveTarget] = useState<AdminUser | null>(null),
    [accessTarget, setAccessTarget] = useState<AdminUser | null>(null),
    [departmentIds, setDepartmentIds] = useState<string[]>([]),
    [boardIds, setBoardIds] = useState<string[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const isSuperadmin = currentUser.role === 'superadmin';
  const directory = useQuery<{ users: AdminUser[] }>({
    queryKey: ['admin-users', status],
    queryFn: () => api(`/admin/users?status=${status}`),
  });
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await directory.refetch();
      return true;
    } catch (reason) {
      setError(err(reason));
      return false;
    } finally {
      setBusy('');
    }
  };
  const openAccess = (item: AdminUser) => {
    setAccessTarget(item);
    setDepartmentIds(item.departmentIds ?? []);
    setBoardIds(item.boardIds ?? []);
    setPasswordTarget(null);
    setProfileTarget(null);
    setArchiveTarget(null);
  };
  const closeAccess = () => {
    setAccessTarget(null);
    setDepartmentIds([]);
    setBoardIds([]);
  };
  const summary = (item: AdminUser) => {
    const departmentCount =
      item.departmentCount ?? item.departmentIds?.length ?? 0;
    const boardCount = item.boardCount ?? item.boardIds?.length ?? 0;
    return `${departmentCount} отд. · ${boardCount} доск.`;
  };
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={720}
      title={
        <div>
          <span className="eyebrow">Администрирование</span>
          <strong>Пользователи и права</strong>
        </div>
      }
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <Stack gap="lg">
        <form
          className="admin-user-create"
          onSubmit={async (event) => {
            event.preventDefault();
            const succeeded = await run('create', () =>
              api('/admin/users', {
                method: 'POST',
                body: JSON.stringify({
                  email,
                  password,
                  role: isSuperadmin ? role : 'user',
                  firstName: firstName.trim() || null,
                  lastName: lastName.trim() || null,
                }),
              }),
            );
            if (succeeded) {
              setEmail('');
              setFirstName('');
              setLastName('');
              setPassword('');
              setRole('user');
            }
          }}
        >
          <div className="section-heading">
            <div>
              <h2>Новый пользователь</h2>
              <p>Доступ к отделам и доскам выдаётся отдельно</p>
            </div>
          </div>
          <TextInput
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
          <Group grow align="flex-start">
            <TextInput
              label="Фамилия"
              value={lastName}
              onChange={(event) => setLastName(event.currentTarget.value)}
              maxLength={80}
            />
            <TextInput
              label="Имя"
              value={firstName}
              onChange={(event) => setFirstName(event.currentTarget.value)}
              maxLength={80}
            />
          </Group>
          <PasswordInput
            label="Пароль для входа"
            description="Не менее 10 символов"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
          {isSuperadmin && (
            <Select
              label="Роль"
              value={role}
              onChange={(value) => setRole(value as AccountRole)}
              data={Object.entries(roleLabel).map(([value, label]) => ({
                value,
                label,
              }))}
              allowDeselect={false}
            />
          )}
          <Button
            type="submit"
            leftSection={<Plus size={16} />}
            loading={busy === 'create'}
          >
            Создать пользователя
          </Button>
        </form>

        <Tabs
          value={status}
          onChange={(value) =>
            setStatus((value as 'active' | 'archived') ?? 'active')
          }
        >
          <Tabs.List>
            <Tabs.Tab value="active">Активные</Tabs.Tab>
            <Tabs.Tab value="archived">Отключённые</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {directory.isLoading && <Text c="dimmed">Загружаем…</Text>}
        {directory.isError && (
          <Text c="red" role="alert">
            Не удалось загрузить пользователей
          </Text>
        )}
        {directory.data?.users.length === 0 && (
          <div className="empty-state">
            {status === 'active'
              ? 'Активных пользователей нет'
              : 'Отключённых пользователей нет'}
          </div>
        )}
        <div className="admin-user-list">
          {directory.data?.users.map((item) => {
            const ownAccount = item.id === currentUser.id,
              ordinaryUser = item.role === 'user',
              canManageAccount = isSuperadmin || ordinaryUser;
            return (
              <section className="admin-user-row" key={item.id}>
                <div className="admin-user-summary">
                  <div>
                    <strong>{personLabel(item)}</strong>
                    {personLabel(item) !== item.email && (
                      <span>{item.email}</span>
                    )}
                    <span>
                      {item.archivedAt
                        ? `Отключён ${date(item.archivedAt)}`
                        : roleLabel[item.role]}
                      {ordinaryUser ? ` · ${summary(item)}` : ''}
                    </span>
                  </div>
                  {item.archivedAt ? (
                    canManageAccount ? (
                      <Button
                        variant="light"
                        loading={busy === `restore:${item.id}`}
                        onClick={() =>
                          void run(`restore:${item.id}`, () =>
                            api(`/admin/users/${item.id}/restore`, {
                              method: 'POST',
                            }),
                          )
                        }
                      >
                        Восстановить
                      </Button>
                    ) : (
                      <Badge variant="light" color="gray">
                        Только для суперадминистратора
                      </Badge>
                    )
                  ) : (
                    <Group gap="xs" wrap="wrap" justify="flex-end">
                      {isSuperadmin && (
                        <Select
                          className="admin-role-select"
                          aria-label={`Роль ${item.email}`}
                          value={item.role}
                          data={Object.entries(roleLabel).map(
                            ([value, label]) => ({ value, label }),
                          )}
                          allowDeselect={false}
                          disabled={ownAccount || Boolean(busy)}
                          onChange={(value) =>
                            value &&
                            void run(`role:${item.id}`, () =>
                              api(`/admin/users/${item.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ role: value }),
                              }),
                            )
                          }
                        />
                      )}
                      {ordinaryUser && (
                        <Button
                          variant="light"
                          leftSection={<UsersRound size={16} />}
                          onClick={() => openAccess(item)}
                        >
                          Доступ
                        </Button>
                      )}
                      {canManageAccount && (
                        <>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            aria-label={`Изменить ФИО ${item.email}`}
                            onClick={() => {
                              setProfileTarget(item);
                              setProfileLastName(item.lastName ?? '');
                              setProfileFirstName(item.firstName ?? '');
                              setPasswordTarget(null);
                              setArchiveTarget(null);
                              closeAccess();
                            }}
                          >
                            <Pencil size={17} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="lg"
                            aria-label={`Сменить пароль ${item.email}`}
                            disabled={ownAccount}
                            onClick={() => {
                              setPasswordTarget(item);
                              setProfileTarget(null);
                              setNewPassword('');
                              setArchiveTarget(null);
                              closeAccess();
                            }}
                          >
                            <KeyRound size={17} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="lg"
                            aria-label={`Отключить ${item.email}`}
                            disabled={ownAccount}
                            onClick={() => {
                              setArchiveTarget(item);
                              setPasswordTarget(null);
                              setProfileTarget(null);
                              closeAccess();
                            }}
                          >
                            <Trash2 size={17} />
                          </ActionIcon>
                        </>
                      )}
                    </Group>
                  )}
                </div>
                {!ordinaryUser && !isSuperadmin && !item.archivedAt && (
                  <Text size="xs" c="dimmed">
                    Управлять учётной записью может только суперадминистратор.
                  </Text>
                )}
                {accessTarget?.id === item.id && (
                  <form
                    className="access-editor"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const succeeded = await run(`access:${item.id}`, () =>
                        api(`/admin/users/${item.id}/access`, {
                          method: 'PUT',
                          body: JSON.stringify({ departmentIds, boardIds }),
                        }),
                      );
                      if (succeeded) closeAccess();
                    }}
                  >
                    <div className="access-editor-heading">
                      <div>
                        <strong>Доступ для {item.email}</strong>
                        <Text size="xs" c="dimmed">
                          Выберите весь отдел или отдельные доски.
                        </Text>
                      </div>
                      <Badge variant="light">
                        {departmentIds.length} отд. · {boardIds.length} доск.
                      </Badge>
                    </div>
                    <div className="access-groups">
                      {departments.map((department) => {
                        const departmentBoards = boards.filter(
                            (board) => board.departmentId === department.id,
                          ),
                          wholeDepartment = departmentIds.includes(
                            department.id,
                          ),
                          selectedBoards = departmentBoards.filter((board) =>
                            boardIds.includes(board.id),
                          ).length;
                        return (
                          <fieldset
                            className="access-group"
                            key={department.id}
                          >
                            <legend>{department.name}</legend>
                            <Checkbox
                              label="Все доски отдела"
                              description="Включая новые доски"
                              checked={wholeDepartment}
                              indeterminate={
                                !wholeDepartment && selectedBoards > 0
                              }
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setDepartmentIds((current) =>
                                  checked
                                    ? [...new Set([...current, department.id])]
                                    : current.filter(
                                        (id) => id !== department.id,
                                      ),
                                );
                                if (checked)
                                  setBoardIds((current) =>
                                    current.filter(
                                      (id) =>
                                        !departmentBoards.some(
                                          (board) => board.id === id,
                                        ),
                                    ),
                                  );
                              }}
                            />
                            {departmentBoards.length === 0 ? (
                              <Text size="xs" c="dimmed">
                                В отделе пока нет досок
                              </Text>
                            ) : (
                              <div className="access-board-list">
                                {departmentBoards.map((board) => (
                                  <Checkbox
                                    key={board.id}
                                    label={`${board.name}${
                                      board.archivedAt ? ' (архив)' : ''
                                    }`}
                                    checked={
                                      wholeDepartment ||
                                      boardIds.includes(board.id)
                                    }
                                    disabled={wholeDepartment}
                                    onChange={(event) =>
                                      setBoardIds((current) =>
                                        event.currentTarget.checked
                                          ? [...new Set([...current, board.id])]
                                          : current.filter(
                                              (id) => id !== board.id,
                                            ),
                                      )
                                    }
                                  />
                                ))}
                              </div>
                            )}
                          </fieldset>
                        );
                      })}
                      {boards.some((board) => !board.departmentId) && (
                        <fieldset className="access-group">
                          <legend>Без отдела</legend>
                          <div className="access-board-list">
                            {boards
                              .filter((board) => !board.departmentId)
                              .map((board) => (
                                <Checkbox
                                  key={board.id}
                                  label={`${board.name}${
                                    board.archivedAt ? ' (архив)' : ''
                                  }`}
                                  checked={boardIds.includes(board.id)}
                                  onChange={(event) =>
                                    setBoardIds((current) =>
                                      event.currentTarget.checked
                                        ? [...new Set([...current, board.id])]
                                        : current.filter(
                                            (id) => id !== board.id,
                                          ),
                                    )
                                  }
                                />
                              ))}
                          </div>
                        </fieldset>
                      )}
                    </div>
                    <Group justify="flex-end">
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        onClick={closeAccess}
                      >
                        Отмена
                      </Button>
                      <Button
                        type="submit"
                        loading={busy === `access:${item.id}`}
                      >
                        Сохранить доступ
                      </Button>
                    </Group>
                  </form>
                )}
                {passwordTarget?.id === item.id && (
                  <form
                    className="user-action-panel"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const succeeded = await run(`password:${item.id}`, () =>
                        api(`/admin/users/${item.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ password: newPassword }),
                        }),
                      );
                      if (succeeded) {
                        setPasswordTarget(null);
                        setNewPassword('');
                      }
                    }}
                  >
                    <PasswordInput
                      label={`Новый пароль для ${item.email}`}
                      minLength={10}
                      value={newPassword}
                      onChange={(event) =>
                        setNewPassword(event.currentTarget.value)
                      }
                      autoFocus
                      required
                    />
                    <Group justify="flex-end">
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        onClick={() => setPasswordTarget(null)}
                      >
                        Отмена
                      </Button>
                      <Button
                        type="submit"
                        loading={busy === `password:${item.id}`}
                      >
                        Сменить пароль
                      </Button>
                    </Group>
                  </form>
                )}
                {profileTarget?.id === item.id && (
                  <form
                    className="user-action-panel"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const succeeded = await run(`profile:${item.id}`, () =>
                        api(`/admin/users/${item.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            firstName: profileFirstName.trim() || null,
                            lastName: profileLastName.trim() || null,
                          }),
                        }),
                      );
                      if (succeeded) {
                        if (item.id === currentUser.id)
                          updateCurrentUser({
                            ...currentUser,
                            firstName: profileFirstName.trim() || null,
                            lastName: profileLastName.trim() || null,
                          });
                        setProfileTarget(null);
                      }
                    }}
                  >
                    <TextInput
                      label={`Фамилия ${item.email}`}
                      value={profileLastName}
                      onChange={(event) =>
                        setProfileLastName(event.currentTarget.value)
                      }
                      maxLength={80}
                      autoFocus
                    />
                    <TextInput
                      label={`Имя ${item.email}`}
                      value={profileFirstName}
                      onChange={(event) =>
                        setProfileFirstName(event.currentTarget.value)
                      }
                      maxLength={80}
                    />
                    <Group justify="flex-end">
                      <Button
                        type="button"
                        variant="subtle"
                        color="gray"
                        onClick={() => setProfileTarget(null)}
                      >
                        Отмена
                      </Button>
                      <Button
                        type="submit"
                        loading={busy === `profile:${item.id}`}
                      >
                        Сохранить ФИО
                      </Button>
                    </Group>
                  </form>
                )}
                {archiveTarget?.id === item.id && (
                  <div
                    className="user-action-panel"
                    role="alertdialog"
                    aria-labelledby={`archive-user-${item.id}`}
                  >
                    <strong id={`archive-user-${item.id}`}>
                      Отключить {item.email}?
                    </strong>
                    <Text size="sm" c="dimmed">
                      Вход и активные сессии будут закрыты. История работы
                      сохранится.
                    </Text>
                    <Group justify="flex-end">
                      <Button
                        variant="subtle"
                        color="gray"
                        autoFocus
                        onClick={() => setArchiveTarget(null)}
                      >
                        Отмена
                      </Button>
                      <Button
                        color="red"
                        loading={busy === `archive:${item.id}`}
                        onClick={async () => {
                          const succeeded = await run(
                            `archive:${item.id}`,
                            () =>
                              api(`/admin/users/${item.id}`, {
                                method: 'DELETE',
                              }),
                          );
                          if (succeeded) setArchiveTarget(null);
                        }}
                      >
                        Отключить
                      </Button>
                    </Group>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {error && <p role="alert">{error}</p>}
      </Stack>
    </MantineDrawer>
  );
}
function ArchivedBoardsDrawer({
  boards,
  close,
  restore,
  destroy,
}: {
  boards: Board[];
  close: () => void;
  restore: (board: Board) => Promise<void>;
  destroy: (board: Board) => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [deleteTarget, setDeleteTarget] = useState<Board | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={420}
      title={
        <div>
          <span className="eyebrow">Доски</span>
          <strong>Архив досок</strong>
        </div>
      }
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <Stack gap="sm">
        <Text c="dimmed" size="sm">
          Восстановленная доска вернётся в рабочий список со всеми задачами.
        </Text>
        {boards.length === 0 && (
          <div className="empty-state">Архивных досок нет</div>
        )}
        {boards.map((board) => (
          <div className="archived-column-row" key={board.id}>
            <div>
              <strong>{board.name}</strong>
              <span>Архивирована {date(board.archivedAt)}</span>
            </div>
            <Group gap="xs">
              <Button
                variant="light"
                onClick={() => {
                  setError('');
                  void restore(board).catch((reason) => setError(err(reason)));
                }}
              >
                Восстановить
              </Button>
              <ActionIcon
                variant="subtle"
                color="red"
                size="lg"
                aria-label={`Удалить доску ${board.name} навсегда`}
                onClick={() => {
                  setDeleteTarget(board);
                  setConfirmation('');
                }}
              >
                <Trash2 size={17} />
              </ActionIcon>
            </Group>
          </div>
        ))}
        {deleteTarget && (
          <div
            className="permanent-delete-panel"
            role="alertdialog"
            aria-labelledby="delete-board-title"
          >
            <strong id="delete-board-title">
              Удалить «{deleteTarget.name}» навсегда?
            </strong>
            <Text size="sm" c="dimmed">
              Это действие нельзя отменить. Удалить можно только доску без
              задач.
            </Text>
            <TextInput
              label={`Введите «${deleteTarget.name}»`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              autoFocus
            />
            <Group justify="flex-end">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => setDeleteTarget(null)}
              >
                Отмена
              </Button>
              <Button
                color="red"
                disabled={confirmation !== deleteTarget.name}
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void destroy(deleteTarget)
                    .then(() => {
                      setDeleteTarget(null);
                      setConfirmation('');
                    })
                    .catch((reason) => setError(err(reason)))
                    .finally(() => setBusy(false));
                }}
              >
                Удалить навсегда
              </Button>
            </Group>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </Stack>
    </MantineDrawer>
  );
}
function QuickAdd({
  board,
  column,
  refresh,
}: {
  board: string;
  column: string;
  refresh: () => Promise<unknown>;
}) {
  const [t, setT] = useState(''),
    [e, setE] = useState(''),
    [expanded, setExpanded] = useState(false);
  if (!expanded)
    return (
      <Button
        className="quick-trigger"
        variant="subtle"
        color="gray"
        leftSection={<Plus size={16} />}
        onClick={() => setExpanded(true)}
      >
        Добавить задачу
      </Button>
    );
  return (
    <form
      className="quick"
      onSubmit={async (x) => {
        x.preventDefault();
        try {
          await api(`/boards/${board}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ columnId: column, title: t }),
          });
          setT('');
          await refresh();
        } catch (y) {
          setE(err(y));
        }
      }}
    >
      <TextInput
        aria-label="Название задачи"
        placeholder="Новая задача"
        value={t}
        onChange={(x) => setT(x.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setT('');
            setExpanded(false);
          }
        }}
        autoFocus
        required
      />
      <Button type="submit">Добавить</Button>
      <Tooltip label="Отмена">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Отмена"
          onClick={() => {
            setT('');
            setExpanded(false);
          }}
        >
          <X size={17} />
        </ActionIcon>
      </Tooltip>
      {e && <small role="alert">{e}</small>}
    </form>
  );
}
function Card({
  task,
  data,
  open,
}: {
  task: Task;
  data: Payload;
  open: () => void;
}) {
  const [start, setStart] = useState<Date | null>(
      task.activeTimer?.startedAt ? new Date(task.activeTimer.startedAt) : null,
    ),
    [, tick] = useState(0),
    {
      attributes,
      listeners,
      setNodeRef,
      setActivatorNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({
      id: task.id,
      disabled: Boolean(task.archivedAt),
      data: { type: 'task', columnId: task.columnId },
    });
  useEffect(() => {
    setStart(
      task.activeTimer?.startedAt ? new Date(task.activeTimer.startedAt) : null,
    );
  }, [task.activeTimer?.startedAt]);
  useEffect(() => {
    if (!start) return;
    const i = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [start]);
  const style: CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };
  return (
    <div
      ref={setNodeRef}
      className={`card${isDragging ? ' dragging' : ''}`}
      style={style}
      data-testid="task-card"
    >
      <button className="card-open" onClick={open}>
        <CardBody task={task} data={data} startedAt={start} />
      </button>
      {!task.archivedAt && (
        <ActionIcon
          ref={setActivatorNodeRef}
          className="card-drag-handle"
          variant="subtle"
          color="gray"
          size="md"
          aria-label={`Переместить «${task.title}»`}
          title="Перетащить или переместить клавишами"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={17} />
        </ActionIcon>
      )}
    </div>
  );
}
function CardBody({
  task,
  data,
  startedAt,
}: {
  task: Task;
  data: Payload;
  startedAt: Date | null;
}) {
  const assignee = data.members?.find((item) => item.id === task.assigneeId),
    assigneeLabel =
      (assignee ? personLabel(assignee) : undefined) ?? task.assigneeName ?? '',
    authorLabel = personLabel(task.author),
    topic = data.topics?.find((item) => item.id === task.topicId),
    initials = assigneeLabel
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join(''),
    hasMetadata = Boolean(
      task.dueAt ||
      task.estimatedMinutes ||
      startedAt ||
      assigneeLabel ||
      task.author,
    );
  return (
    <>
      {Boolean(topic || task.labels?.length) && (
        <span className="card-tags" aria-label="Тема и метки">
          {topic && (
            <i className="topic-tag">
              <span
                className="tag-dot"
                style={{ backgroundColor: topic.color ?? '#64748b' }}
                aria-hidden="true"
              />
              {topic.name}
            </i>
          )}
          {task.labels?.slice(0, 2).map((label) => (
            <i className="label-tag" key={label.id}>
              <span
                className="tag-dot"
                style={{ backgroundColor: label.color ?? '#64748b' }}
                aria-hidden="true"
              />
              {label.name}
            </i>
          ))}
        </span>
      )}
      <b>{task.completedAt ? `${task.title} · Выполнена` : task.title}</b>
      {task.description && (
        <span className="card-description">{task.description}</span>
      )}
      {hasMetadata && (
        <footer>
          {task.dueAt && (
            <i className="card-meta">
              <CalendarClock size={13} /> {date(task.dueAt)}
            </i>
          )}
          {task.estimatedMinutes && (
            <i className="card-meta">
              <TimerReset size={13} /> {duration(task.estimatedMinutes * 60)}
            </i>
          )}
          {startedAt && (
            <i className="run">
              <Timer size={13} />{' '}
              {duration((Date.now() - startedAt.getTime()) / 1000)}
            </i>
          )}
          {assigneeLabel && (
            <i
              className={`avatar${assignee ? '' : ' text-assignee'}`}
              title={assignee ? assigneeLabel : `${assigneeLabel} · имя`}
            >
              {initials}
            </i>
          )}
          {task.author && (
            <i
              className="card-meta card-author"
              title={`Автор: ${authorLabel}`}
            >
              <UserRound size={13} /> {authorLabel}
            </i>
          )}
        </footer>
      )}
    </>
  );
}
function CardDragPreview({ task, data }: { task: Task; data: Payload }) {
  return (
    <div className="card drag-overlay" data-testid="task-drag-preview">
      <div className="card-open">
        <CardBody
          task={task}
          data={data}
          startedAt={
            task.activeTimer?.startedAt
              ? new Date(task.activeTimer.startedAt)
              : null
          }
        />
      </div>
      <span className="card-drag-handle" aria-hidden="true">
        <GripVertical size={17} />
      </span>
    </div>
  );
}
function KanbanColumn({
  column,
  data,
  boardId,
  canManage,
  visible,
  open,
  refresh,
}: {
  column: Column;
  data: Payload;
  boardId: string;
  canManage: boolean;
  visible: (task: Task) => boolean;
  open: (task: Task) => void;
  refresh: () => Promise<unknown>;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });
  const tasks = column.tasks.filter(visible),
    hasActiveTasks = column.tasks.some((task) => !task.archivedAt),
    [editing, setEditing] = useState(false),
    [confirmArchive, setConfirmArchive] = useState(false),
    [name, setName] = useState(column.name),
    [busy, setBusy] = useState(false),
    [columnError, setColumnError] = useState('');
  const returnToColumnMenu = () =>
    window.requestAnimationFrame(() =>
      document.getElementById(`column-menu-${column.id}`)?.focus(),
    );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setColumnError('');
    try {
      await action();
      await refresh();
    } catch (error) {
      setColumnError(err(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      ref={setNodeRef}
      className={`column${isOver ? ' drop-target' : ''}`}
      data-testid="kanban-column"
    >
      <header>
        <h2>{column.name}</h2>
        <div className="column-header-actions">
          <span aria-label={`Задач: ${tasks.length}`}>{tasks.length}</span>
          {canManage && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  id={`column-menu-${column.id}`}
                  className="column-menu-button"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Меню колонки ${column.name}`}
                >
                  <MoreHorizontal size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{column.name}</Menu.Label>
                <Menu.Item
                  leftSection={<Pencil size={15} />}
                  onClick={() => {
                    setName(column.name);
                    setEditing(true);
                    setConfirmArchive(false);
                  }}
                >
                  Переименовать
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<Archive size={15} />}
                  disabled={hasActiveTasks}
                  onClick={() => {
                    setEditing(false);
                    setConfirmArchive(true);
                  }}
                >
                  Архивировать колонку
                </Menu.Item>
                {hasActiveTasks && (
                  <Menu.Label>Сначала переместите задачи</Menu.Label>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
        </div>
      </header>
      {editing && (
        <form
          className="column-inline-form"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
              returnToColumnMenu();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await api(`/boards/${boardId}/columns/${column.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name: name.trim() }),
              });
              setEditing(false);
            });
          }}
        >
          <TextInput
            aria-label="Новое название колонки"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
          <ActionIcon
            type="submit"
            variant="light"
            color="blue"
            size="lg"
            disabled={busy}
            aria-label="Сохранить название колонки"
          >
            <Check size={17} />
          </ActionIcon>
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            size="lg"
            aria-label="Отменить переименование колонки"
            onClick={() => {
              setEditing(false);
              returnToColumnMenu();
            }}
          >
            <X size={17} />
          </ActionIcon>
        </form>
      )}
      {confirmArchive && (
        <div
          className="column-confirm"
          role="alertdialog"
          aria-labelledby={`archive-column-title-${column.id}`}
        >
          <strong id={`archive-column-title-${column.id}`}>
            Архивировать пустую колонку?
          </strong>
          <Group gap="xs">
            <Button
              autoFocus
              size="compact-sm"
              color="red"
              variant="light"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/boards/${boardId}/columns/${column.id}/archive`, {
                    method: 'POST',
                  });
                  setConfirmArchive(false);
                })
              }
            >
              Подтвердить архивирование
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => {
                setConfirmArchive(false);
                returnToColumnMenu();
              }}
            >
              Отмена
            </Button>
          </Group>
        </div>
      )}
      {columnError && (
        <small className="column-error" role="alert">
          {columnError}
        </small>
      )}
      <QuickAdd board={boardId} column={column.id} refresh={refresh} />
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {tasks.map((task) => (
          <Card task={task} data={data} key={task.id} open={() => open(task)} />
        ))}
      </SortableContext>
    </article>
  );
}
function AddColumn({
  boardId,
  refresh,
}: {
  boardId: string;
  refresh: () => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const close = () => {
    setExpanded(false);
    setName('');
    setError('');
  };
  return (
    <Popover
      opened={expanded}
      onChange={(opened) => (opened ? setExpanded(true) : close())}
      width={320}
      position="bottom-end"
      shadow="md"
      trapFocus
    >
      <Popover.Target>
        <Button
          variant="default"
          leftSection={<Plus size={16} />}
          onClick={() => setExpanded((value) => !value)}
        >
          Добавить колонку
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form
          className="add-column-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void api(`/boards/${boardId}/columns`, {
              method: 'POST',
              body: JSON.stringify({ name: name.trim() }),
            })
              .then(async () => {
                close();
                await refresh();
              })
              .catch((reason: unknown) => setError(err(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <TextInput
            label="Название новой колонки"
            placeholder="Например, На проверке"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
          />
          <Group gap="xs">
            <Button type="submit" disabled={busy || !name.trim()}>
              Создать колонку
            </Button>
            <Button type="button" variant="subtle" color="gray" onClick={close}>
              Отмена
            </Button>
          </Group>
          {error && <small role="alert">{error}</small>}
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
function TaskHistory({ boardId, taskId }: { boardId: string; taskId: string }) {
  const history = useQuery<{ events: TaskEvent[] }>({
    queryKey: ['task-history', boardId, taskId],
    queryFn: () => api(`/boards/${boardId}/tasks/${taskId}/history`),
  });
  const person = (
    value: Partial<
      Pick<Person, 'firstName' | 'lastName' | 'name' | 'email'>
    > | null,
  ) => (value ? personLabel(value) : 'Не назначен');
  if (history.isLoading)
    return <div className="history-state">Загружаем историю…</div>;
  if (history.isError)
    return (
      <div className="history-state" role="alert">
        Не удалось загрузить историю
      </div>
    );
  if (!history.data?.events.length)
    return <div className="history-state">История пока пуста</div>;
  return (
    <ol className="task-history" aria-label="История задачи">
      {history.data.events.map((event) => {
        const actor = person(event.actor);
        return (
          <li
            key={event.id}
            data-event-type={event.type}
            data-testid="task-history-event"
          >
            <span className="history-icon" aria-hidden="true">
              {event.type === 'assignee_changed' ? (
                <UserRound size={16} />
              ) : event.type === 'column_changed' ? (
                <Columns3 size={16} />
              ) : event.type === 'completed' ? (
                <Check size={16} />
              ) : (
                <Plus size={16} />
              )}
            </span>
            <div>
              <p>
                <strong>{actor}</strong>{' '}
                {event.type === 'created' && 'создал задачу'}
                {event.type === 'completed' && 'отметил(а) задачу выполненной'}
                {event.type === 'column_changed' && (
                  <>
                    переместил задачу: <b>{event.fromColumn?.name}</b>
                    <span aria-hidden="true"> → </span>
                    <b>{event.toColumn?.name}</b>
                  </>
                )}
                {event.type === 'assignee_changed' && (
                  <>
                    изменил исполнителя: <b>{person(event.fromAssignee)}</b>
                    <span aria-hidden="true"> → </span>
                    <b>{person(event.toAssignee)}</b>
                  </>
                )}
              </p>
              <time dateTime={event.createdAt}>
                {new Intl.DateTimeFormat('ru-RU', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(event.createdAt))}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
function TaskDrawer({
  data,
  task,
  close,
  refresh,
}: {
  data: Payload;
  task: Task;
  close: () => void;
  refresh: () => Promise<unknown>;
}) {
  const [t, setT] = useState(task.title),
    [desc, setDesc] = useState(task.description ?? ''),
    [assignee, setAssignee] = useState(taskAssigneeKey(task)),
    [topic, setTopic] = useState(task.topicId ?? ''),
    [labels, setLabels] = useState(
      task.labelIds ?? task.labels?.map((x) => x.id) ?? [],
    ),
    [due, setDue] = useState(date(task.dueAt)),
    [estimate, setEstimate] = useState(
      task.estimatedMinutes ? String(task.estimatedMinutes) : '',
    ),
    [move, setMove] = useState(task.columnId),
    [mins, setMins] = useState(''),
    [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10)),
    [labelName, setLabelName] = useState(''),
    [labelColor, setLabelColor] = useState('#2563eb'),
    [confirmComplete, setConfirmComplete] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const canManage = true;
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await f();
      await refresh();
    } catch (x) {
      setError(err(x));
    } finally {
      setBusy(false);
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const assigneePatch = assignee.startsWith('user:')
      ? { assigneeId: assignee.slice(5) }
      : assignee.startsWith('text:')
        ? { assigneeName: assignee.slice(5) }
        : { assigneeId: null };
    return act(() =>
      api(`/boards/${data.board.id}/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: t,
          description: desc,
          ...assigneePatch,
          topicId: topic || null,
          labelIds: labels,
          dueAt: due || null,
          estimatedMinutes: estimate ? Number(estimate) : null,
        }),
      }),
    );
  };
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={620}
      title={
        <div>
          <span className="eyebrow">
            {task.archivedAt ? 'Архивная задача' : 'Задача'}
          </span>
          <strong>{task.title}</strong>
        </div>
      }
      overlayProps={{ backgroundOpacity: 0.55, blur: 2 }}
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <Tabs defaultValue="details" keepMounted={false} className="task-tabs">
        <Tabs.List>
          <Tabs.Tab value="details">Задача</Tabs.Tab>
          <Tabs.Tab value="history" leftSection={<HistoryIcon size={15} />}>
            История
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="details" pt="lg">
          <div className="task-details">
            <section className="timer-panel" aria-label="Учёт времени">
              <div>
                <span>Затрачено</span>
                <strong>{duration(task.timeSeconds)}</strong>
              </div>
              {task.activeTimer ? (
                <Button
                  color="red"
                  leftSection={<Timer size={17} />}
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      api(`/time-entries/${task.activeTimer!.id}/stop`, {
                        method: 'POST',
                      }),
                    )
                  }
                >
                  Остановить таймер
                </Button>
              ) : (
                <Button
                  variant="light"
                  leftSection={<Timer size={17} />}
                  disabled={busy || !!task.archivedAt}
                  onClick={() =>
                    void act(() =>
                      api(`/tasks/${task.id}/timer/start`, { method: 'POST' }),
                    )
                  }
                >
                  Запустить таймер
                </Button>
              )}
            </section>
            <section className="task-author" aria-label="Автор задачи">
              <span>Автор задачи</span>
              <strong>{personLabel(task.author)}</strong>
            </section>
            <form className="task-form" onSubmit={save}>
              <TextInput
                label="Название"
                value={t}
                onChange={(e) => setT(e.target.value)}
                required
              />
              <Textarea
                label="Описание"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Опишите задачу"
                autosize
                minRows={5}
                maxRows={12}
              />
              <div className="property-grid">
                <AssigneeCombobox
                  members={data.members ?? []}
                  value={assignee}
                  onChange={setAssignee}
                />
                <Select
                  label="Тема"
                  placeholder="Без темы"
                  clearable
                  searchable
                  value={topic || null}
                  onChange={(value) => setTopic(value ?? '')}
                  data={(data.topics ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
                <DateInput
                  label="Срок"
                  placeholder="Не указан"
                  dateParser={parseRussianDateInput}
                  value={due || null}
                  onChange={(value) => setDue(value ?? '')}
                  valueFormat="DD.MM.YYYY"
                  clearable
                />
                <NumberInput
                  label="Оценка времени"
                  placeholder="В минутах"
                  min={1}
                  suffix=" мин"
                  value={estimate}
                  onChange={(value) => setEstimate(String(value))}
                />
              </div>
              <div className="labels-field">
                <MultiSelect
                  label="Метки"
                  placeholder="Выберите метки"
                  searchable
                  clearable
                  value={labels}
                  onChange={setLabels}
                  data={(data.labels ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  nothingFoundMessage="Метки не найдены"
                />
                {canManage && (
                  <Popover width={300} position="bottom-start" shadow="md">
                    <Popover.Target>
                      <Button
                        variant="subtle"
                        size="sm"
                        leftSection={<Plus size={15} />}
                      >
                        Создать метку
                      </Button>
                    </Popover.Target>
                    <Popover.Dropdown>
                      <Stack gap="sm">
                        <Text fw={650} size="sm">
                          Новая метка
                        </Text>
                        <TextInput
                          label="Название"
                          value={labelName}
                          onChange={(event) => setLabelName(event.target.value)}
                        />
                        <ColorInput
                          label="Цвет"
                          value={labelColor}
                          onChange={setLabelColor}
                          format="hex"
                        />
                        <Button
                          disabled={!labelName.trim()}
                          onClick={() =>
                            void act(async () => {
                              const created = await api<{ label: Tag }>(
                                `/boards/${data.board.id}/labels`,
                                {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    name: labelName.trim(),
                                    color: labelColor,
                                  }),
                                },
                              );
                              setLabels((current) => [
                                ...current,
                                created.label.id,
                              ]);
                              setLabelName('');
                            })
                          }
                        >
                          Создать и выбрать
                        </Button>
                      </Stack>
                    </Popover.Dropdown>
                  </Popover>
                )}
              </div>
              <Select
                label="Колонка"
                value={move}
                onChange={(value) => {
                  if (!value) return;
                  setMove(value);
                  if (value !== task.columnId)
                    void act(() =>
                      api(`/boards/${data.board.id}/tasks/${task.id}/move`, {
                        method: 'POST',
                        body: JSON.stringify({ columnId: value }),
                      }),
                    );
                }}
                data={data.columns.map((column) => ({
                  value: column.id,
                  label: column.name,
                }))}
              />
              <Group justify="space-between" className="task-actions">
                <Group gap="xs">
                  <Button type="submit" disabled={busy}>
                    Сохранить изменения
                  </Button>
                  {!task.completedAt && (
                    <Button
                      type="button"
                      color="green"
                      leftSection={<Check size={16} />}
                      disabled={busy || !!task.archivedAt}
                      onClick={() => setConfirmComplete(true)}
                    >
                      Выполнить
                    </Button>
                  )}
                </Group>
                <Menu position="top-end">
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="lg"
                      aria-label="Другие действия"
                    >
                      <MoreHorizontal size={20} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      color="red"
                      leftSection={<Archive size={16} />}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            `/boards/${data.board.id}/tasks/${task.id}/${task.archivedAt ? 'restore' : 'archive'}`,
                            { method: 'POST' },
                          );
                          close();
                        })
                      }
                    >
                      {task.archivedAt
                        ? 'Восстановить задачу'
                        : 'Архивировать задачу'}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </form>
            <section className="manual-time">
              <div className="section-heading">
                <div>
                  <h2>Добавить время вручную</h2>
                  <p>Если работа выполнялась без запущенного таймера</p>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    await api(`/tasks/${task.id}/time-entries/manual`, {
                      method: 'POST',
                      body: JSON.stringify({ minutes: Number(mins), workDate }),
                    });
                    setMins('');
                  });
                }}
              >
                <div className="manual-time-grid">
                  <NumberInput
                    label="Продолжительность"
                    min={1}
                    max={1440}
                    suffix=" мин"
                    value={mins}
                    onChange={(value) => setMins(String(value))}
                    required
                  />
                  <DateInput
                    label="Дата работы"
                    dateParser={parseRussianDateInput}
                    value={workDate}
                    onChange={(value) => setWorkDate(value ?? '')}
                    valueFormat="DD.MM.YYYY"
                    required
                  />
                  <Button type="submit" disabled={busy}>
                    Добавить время
                  </Button>
                </div>
              </form>
            </section>
            <section className="files-section">
              <div className="section-heading">
                <div>
                  <h2>Файлы</h2>
                  <p>Скриншоты и документы до 10 МБ</p>
                </div>
              </div>
              <div className="file-list">
                {task.attachments?.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={`/api/attachments/${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Paperclip size={15} /> {attachment.fileName}
                  </a>
                ))}
              </div>
              <FileInput
                aria-label="Прикрепить файл"
                placeholder="Выберите файл"
                leftSection={<FileUp size={16} />}
                disabled={busy || !!task.archivedAt}
                clearable
                onChange={(file) => {
                  if (file)
                    void act(() => {
                      const body = new FormData();
                      body.append('file', file);
                      return api(`/tasks/${task.id}/attachments`, {
                        method: 'POST',
                        body,
                      });
                    });
                }}
              />
            </section>
            {error && <p role="alert">{error}</p>}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="lg">
          <TaskHistory boardId={data.board.id} taskId={task.id} />
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={confirmComplete}
        onClose={() => setConfirmComplete(false)}
        title="Подтвердить выполнение"
        centered
        size="sm"
      >
        <Stack gap="sm">
          <Text>Отметить задачу «{task.title}» выполненной?</Text>
          <Text c="dimmed" size="sm">
            Автору задачи будет отправлено письмо на рабочую почту, если в
            системе настроен SMTP Outlook.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              color="gray"
              onClick={() => setConfirmComplete(false)}
            >
              Отмена
            </Button>
            <Button
              color="green"
              loading={busy}
              onClick={() =>
                void act(async () => {
                  await api(
                    `/boards/${data.board.id}/tasks/${task.id}/complete`,
                    {
                      method: 'POST',
                    },
                  );
                  setConfirmComplete(false);
                })
              }
            >
              Да, выполнить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </MantineDrawer>
  );
}
function TimeView({ data, close }: { data: Payload; close: () => void }) {
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [fromCalendarOpened, setFromCalendarOpened] = useState(false),
    [toCalendarOpened, setToCalendarOpened] = useState(false),
    [person, setPerson] = useState(''),
    [topic, setTopic] = useState(''),
    [taskFilter, setTaskFilter] = useState('');
  const q = useQuery<{
    entries: {
      id: string;
      taskId: string;
      userId: string;
      startedAt: string;
      stoppedAt: string | null;
    }[];
  }>({
    queryKey: ['time', data.board.id],
    queryFn: () => api(`/boards/${data.board.id}/time-entries`),
  });
  const tasks = data.columns.flatMap((column) => column.tasks);
  const entries =
    q.data?.entries.filter((entry) => {
      const task = tasks.find((item) => item.id === entry.taskId);
      return (
        (!from || entry.startedAt.slice(0, 10) >= from) &&
        (!to || entry.startedAt.slice(0, 10) <= to) &&
        (!person || entry.userId === person) &&
        (!topic || task?.topicId === topic) &&
        (!taskFilter || entry.taskId === taskFilter)
      );
    }) ?? [];
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={620}
      title={
        <div>
          <span className="eyebrow">Доска «{data.board.name}»</span>
          <strong>Учёт времени</strong>
        </div>
      }
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <div className="time-filters">
        <DateInput
          label="Дата от"
          dateParser={parseRussianDateInput}
          value={from || null}
          onChange={(value) => {
            setFrom(value ?? '');
            if (value) setFromCalendarOpened(false);
          }}
          onFocus={() => setFromCalendarOpened(true)}
          onClick={() => setFromCalendarOpened(true)}
          onBlur={() => setFromCalendarOpened(false)}
          popoverProps={{
            opened: fromCalendarOpened,
            onChange: setFromCalendarOpened,
          }}
          valueFormat="DD.MM.YYYY"
          clearable
        />
        <DateInput
          label="Дата до"
          dateParser={parseRussianDateInput}
          value={to || null}
          onChange={(value) => {
            setTo(value ?? '');
            if (value) setToCalendarOpened(false);
          }}
          onFocus={() => setToCalendarOpened(true)}
          onClick={() => setToCalendarOpened(true)}
          onBlur={() => setToCalendarOpened(false)}
          popoverProps={{
            opened: toCalendarOpened,
            onChange: setToCalendarOpened,
          }}
          valueFormat="DD.MM.YYYY"
          clearable
        />
        <Select
          label="Пользователь"
          placeholder="Все пользователи"
          clearable
          searchable
          value={person || null}
          onChange={(value) => setPerson(value ?? '')}
          data={(data.members ?? []).map((member) => ({
            value: member.id,
            label: personOptionLabel(member),
          }))}
        />
        <Select
          label="Тема"
          placeholder="Все темы"
          clearable
          value={topic || null}
          onChange={(value) => setTopic(value ?? '')}
          data={(data.topics ?? []).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
        />
        <Select
          className="time-task-filter"
          label="Задача"
          placeholder="Все задачи"
          clearable
          searchable
          value={taskFilter || null}
          onChange={(value) => setTaskFilter(value ?? '')}
          data={tasks.map((item) => ({ value: item.id, label: item.title }))}
        />
      </div>
      <div className="time-list">
        {q.isLoading && <Text c="dimmed">Загрузка…</Text>}
        {!q.isLoading && entries.length === 0 && (
          <div className="empty-state">
            <Clock3 size={22} />
            <span>За выбранный период записей нет</span>
          </div>
        )}
        {entries.map((entry) => {
          const task = tasks.find((item) => item.id === entry.taskId);
          const member = data.members?.find((item) => item.id === entry.userId);
          return (
            <div className="time-entry" key={entry.id}>
              <div>
                <strong>{task?.title ?? 'Задача'}</strong>
                <span>{personLabel(member)}</span>
              </div>
              <div>
                <strong>
                  {entry.stoppedAt
                    ? duration(
                        (new Date(entry.stoppedAt).getTime() -
                          new Date(entry.startedAt).getTime()) /
                          1000,
                      )
                    : 'Таймер запущен'}
                </strong>
                <span>{date(entry.startedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </MantineDrawer>
  );
}
function Settings({
  data,
  currentUser,
  departments,
  close,
  refresh,
  refreshNavigation,
  archiveBoard,
}: {
  data: Payload;
  currentUser: User;
  departments: Department[];
  close: () => void;
  refresh: () => Promise<unknown>;
  refreshNavigation: () => Promise<unknown>;
  archiveBoard: () => Promise<void>;
}) {
  const archivedColumns = useQuery<{ columns: ArchivedColumn[] }>({
      queryKey: ['archived-columns', data.board.id],
      queryFn: () => api(`/boards/${data.board.id}/columns/archived`),
    }),
    directory = useQuery<{ users: AdminUser[] }>({
      queryKey: ['admin-users', 'active'],
      queryFn: () => api('/admin/users?status=active'),
      enabled: currentUser.role !== 'user',
    }),
    [boardName, setBoardName] = useState(data.board.name),
    [boardDepartment, setBoardDepartment] = useState(
      data.board.departmentId ?? '',
    ),
    [memberUserId, setMemberUserId] = useState(''),
    [columnName, setColumnName] = useState(''),
    [topicName, setTopicName] = useState(''),
    [topicColor, setTopicColor] = useState('#64748b'),
    [labelName, setLabelName] = useState(''),
    [labelColor, setLabelColor] = useState('#2563eb'),
    [pendingColumnArchive, setPendingColumnArchive] = useState<string | null>(
      null,
    ),
    [pendingBoardArchive, setPendingBoardArchive] = useState(false),
    [error, setError] = useState('');
  const returnToSettingsArchive = (columnId: string) =>
    window.requestAnimationFrame(() =>
      document.getElementById(`settings-archive-${columnId}`)?.focus(),
    );
  const run = async (f: () => Promise<unknown>) => {
    try {
      setError('');
      await f();
      await refresh();
      return true;
    } catch (e) {
      setError(err(e));
      return false;
    }
  };
  return (
    <MantineDrawer
      opened
      onClose={close}
      position="right"
      size={660}
      title={
        <div>
          <span className="eyebrow">{data.board.name}</span>
          <strong>Настроить доску</strong>
        </div>
      }
      classNames={{ content: 'task-drawer', body: 'task-drawer-body' }}
    >
      <Tabs defaultValue="general" keepMounted={false}>
        <Tabs.List className="settings-tabs">
          <Tabs.Tab value="general">Общие</Tabs.Tab>
          <Tabs.Tab value="columns">Колонки</Tabs.Tab>
          <Tabs.Tab value="taxonomy">Темы и метки</Tabs.Tab>
          {currentUser.role !== 'user' && (
            <Tabs.Tab value="members">Доступ</Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="general" pt="lg">
          <Stack gap="lg">
            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api(`/boards/${data.board.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ name: boardName.trim() }),
                  });
                  await refreshNavigation();
                });
              }}
            >
              <TextInput
                label="Название доски"
                value={boardName}
                onChange={(event) => setBoardName(event.target.value)}
                required
              />
              <Button type="submit">Сохранить название</Button>
            </form>
            <form
              className="settings-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!boardDepartment) return;
                void run(async () => {
                  await api(`/boards/${data.board.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ departmentId: boardDepartment }),
                  });
                  await refreshNavigation();
                });
              }}
            >
              <Select
                label="Отдел"
                value={boardDepartment || null}
                onChange={(value) => setBoardDepartment(value ?? '')}
                data={departments
                  .filter(
                    (department) =>
                      department.id === data.board.departmentId ||
                      department.canManage !== false,
                  )
                  .map((department) => ({
                    value: department.id,
                    label: department.name,
                  }))}
                required
              />
              <Button
                type="submit"
                disabled={
                  !boardDepartment ||
                  boardDepartment === data.board.departmentId
                }
              >
                Сменить отдел
              </Button>
            </form>
            <section className="danger-zone">
              <div>
                <h3>Архивировать доску</h3>
                <p>Доска исчезнет из рабочего списка, но данные сохранятся.</p>
              </div>
              {!pendingBoardArchive ? (
                <Button
                  color="red"
                  variant="light"
                  leftSection={<Archive size={16} />}
                  onClick={() => setPendingBoardArchive(true)}
                >
                  Архивировать доску
                </Button>
              ) : (
                <div
                  className="settings-column-confirm"
                  role="alertdialog"
                  aria-labelledby="archive-board-title"
                >
                  <strong id="archive-board-title">
                    Архивировать «{data.board.name}»?
                  </strong>
                  <Group gap="xs">
                    <Button
                      autoFocus
                      size="compact-sm"
                      variant="subtle"
                      color="gray"
                      onClick={() => setPendingBoardArchive(false)}
                    >
                      Отмена
                    </Button>
                    <Button
                      size="compact-sm"
                      color="red"
                      onClick={() =>
                        void archiveBoard().catch((reason) =>
                          setError(err(reason)),
                        )
                      }
                    >
                      Архивировать
                    </Button>
                  </Group>
                </div>
              )}
            </section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="columns" pt="lg">
          <Stack gap="md">
            <div className="section-heading">
              <div>
                <h2>Колонки</h2>
                <p>Этапы рабочего процесса слева направо</p>
              </div>
            </div>
            {data.columns.map((column) => {
              const hasTasks = column.tasks.some((task) => !task.archivedAt);
              return (
                <div className="settings-column-item" key={column.id}>
                  <form
                    className="settings-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = String(
                        new FormData(event.currentTarget).get('name') ?? '',
                      ).trim();
                      if (name)
                        void run(() =>
                          api(`/boards/${data.board.id}/columns/${column.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ name }),
                          }),
                        );
                    }}
                  >
                    <TextInput
                      name="name"
                      aria-label={`Название колонки ${column.name}`}
                      defaultValue={column.name}
                    />
                    <ActionIcon
                      type="submit"
                      variant="light"
                      color="blue"
                      size="lg"
                      aria-label={`Сохранить колонку ${column.name}`}
                    >
                      <Check size={17} />
                    </ActionIcon>
                    <ActionIcon
                      id={`settings-archive-${column.id}`}
                      type="button"
                      variant="subtle"
                      color="red"
                      size="lg"
                      disabled={hasTasks}
                      title={
                        hasTasks
                          ? 'Сначала переместите задачи'
                          : 'Архивировать колонку'
                      }
                      aria-label={`Архивировать колонку ${column.name}`}
                      onClick={() => setPendingColumnArchive(column.id)}
                    >
                      <Archive size={17} />
                    </ActionIcon>
                  </form>
                  {hasTasks && (
                    <Text size="xs" c="dimmed">
                      Чтобы архивировать колонку, сначала переместите задачи
                    </Text>
                  )}
                  {pendingColumnArchive === column.id && (
                    <div
                      className="settings-column-confirm"
                      role="alertdialog"
                      aria-labelledby={`settings-archive-title-${column.id}`}
                    >
                      <strong id={`settings-archive-title-${column.id}`}>
                        Архивировать пустую колонку «{column.name}»?
                      </strong>
                      <Group gap="xs">
                        <Button
                          size="compact-sm"
                          color="red"
                          variant="light"
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/boards/${data.board.id}/columns/${column.id}/archive`,
                                { method: 'POST' },
                              );
                              setPendingColumnArchive(null);
                              await archivedColumns.refetch();
                            })
                          }
                        >
                          Архивировать
                        </Button>
                        <Button
                          autoFocus
                          size="compact-sm"
                          variant="subtle"
                          color="gray"
                          onClick={() => {
                            setPendingColumnArchive(null);
                            returnToSettingsArchive(column.id);
                          }}
                        >
                          Отмена
                        </Button>
                      </Group>
                    </div>
                  )}
                </div>
              );
            })}
            <form
              className="settings-create-row"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api(`/boards/${data.board.id}/columns`, {
                    method: 'POST',
                    body: JSON.stringify({ name: columnName.trim() }),
                  });
                  setColumnName('');
                });
              }}
            >
              <TextInput
                label="Новая колонка"
                placeholder="Например, На проверке"
                value={columnName}
                onChange={(event) => setColumnName(event.target.value)}
                required
              />
              <Button type="submit" leftSection={<Plus size={16} />}>
                Создать колонку
              </Button>
            </form>
            <section className="archived-columns">
              <div className="section-heading">
                <div>
                  <h3>Архив колонок</h3>
                  <p>Восстановленная колонка появится справа на доске</p>
                </div>
              </div>
              {archivedColumns.isLoading && (
                <Text size="sm" c="dimmed">
                  Загружаем архив…
                </Text>
              )}
              {archivedColumns.isError && (
                <Text size="sm" c="red" role="alert">
                  Не удалось загрузить архив колонок
                </Text>
              )}
              {archivedColumns.data?.columns.length === 0 && (
                <Text size="sm" c="dimmed">
                  Архивных колонок нет
                </Text>
              )}
              {archivedColumns.data?.columns.map((column) => (
                <div className="archived-column-row" key={column.id}>
                  <div>
                    <strong>{column.name}</strong>
                    <span>Архивирована {date(column.archivedAt)}</span>
                  </div>
                  <Button
                    variant="light"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/boards/${data.board.id}/columns/${column.id}/restore`,
                          { method: 'POST' },
                        );
                        await archivedColumns.refetch();
                      })
                    }
                  >
                    Восстановить
                  </Button>
                </div>
              ))}
            </section>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="taxonomy" pt="lg">
          <div className="taxonomy-grid">
            <section>
              <div className="section-heading">
                <div>
                  <h2>Темы</h2>
                  <p>Одна основная категория задачи</p>
                </div>
              </div>
              <div className="taxonomy-list">
                {(data.topics ?? []).map((item) => (
                  <Badge
                    key={item.id}
                    variant="light"
                    color={item.color ?? 'gray'}
                  >
                    {item.name}
                  </Badge>
                ))}
              </div>
              <form
                className="taxonomy-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/boards/${data.board.id}/topics`, {
                      method: 'POST',
                      body: JSON.stringify({
                        name: topicName.trim(),
                        color: topicColor,
                      }),
                    });
                    setTopicName('');
                  });
                }}
              >
                <TextInput
                  label="Название темы"
                  value={topicName}
                  onChange={(event) => setTopicName(event.target.value)}
                  required
                />
                <ColorInput
                  label="Цвет"
                  value={topicColor}
                  onChange={setTopicColor}
                  format="hex"
                />
                <Button type="submit" leftSection={<Plus size={16} />}>
                  Создать тему
                </Button>
              </form>
            </section>
            <section>
              <div className="section-heading">
                <div>
                  <h2>Метки</h2>
                  <p>Дополнительные признаки задачи</p>
                </div>
              </div>
              <div className="taxonomy-list">
                {(data.labels ?? []).map((item) => (
                  <Badge
                    key={item.id}
                    variant="dot"
                    color={item.color ?? 'gray'}
                  >
                    {item.name}
                  </Badge>
                ))}
              </div>
              <form
                className="taxonomy-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/boards/${data.board.id}/labels`, {
                      method: 'POST',
                      body: JSON.stringify({
                        name: labelName.trim(),
                        color: labelColor,
                      }),
                    });
                    setLabelName('');
                  });
                }}
              >
                <TextInput
                  label="Название метки"
                  value={labelName}
                  onChange={(event) => setLabelName(event.target.value)}
                  required
                />
                <ColorInput
                  label="Цвет"
                  value={labelColor}
                  onChange={setLabelColor}
                  format="hex"
                />
                <Button type="submit" leftSection={<Plus size={16} />}>
                  Создать метку
                </Button>
              </form>
            </section>
          </div>
        </Tabs.Panel>

        {currentUser.role !== 'user' && (
          <Tabs.Panel value="members" pt="lg">
            <Stack gap="md">
              <div className="section-heading">
                <div>
                  <h2>Доступ к доске</h2>
                  <p>Участники видят задачи и могут работать с доской</p>
                </div>
              </div>
              {(data.members ?? []).map((member) => {
                const source = member.accessSource ?? 'board';
                const canRemoveDirect = source === 'board' || source === 'both';
                return (
                  <div className="member-row" key={member.id}>
                    <div>
                      <strong>{personLabel(member)}</strong>
                      <span>
                        {member.accountRole
                          ? roleLabel[member.accountRole]
                          : 'Пользователь'}
                        {' · '}
                        {accessSourceLabel[source]}
                        {member.archivedAt ? ' · отключён' : ''}
                      </span>
                    </div>
                    {canRemoveDirect ? (
                      <Button
                        variant="subtle"
                        color="red"
                        onClick={() =>
                          void run(() =>
                            api(
                              `/boards/${data.board.id}/members/${member.id}`,
                              {
                                method: 'DELETE',
                              },
                            ),
                          )
                        }
                      >
                        Убрать доступ
                      </Button>
                    ) : (
                      <Badge variant="light" color="gray">
                        Без прямого доступа
                      </Badge>
                    )}
                  </div>
                );
              })}
              <form
                className="settings-form member-create-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!memberUserId) return;
                  const succeeded = await run(() =>
                    api(`/boards/${data.board.id}/members`, {
                      method: 'POST',
                      body: JSON.stringify({
                        userId: memberUserId,
                      }),
                    }),
                  );
                  if (succeeded) setMemberUserId('');
                }}
              >
                <Select
                  label="Добавить пользователя"
                  placeholder="Выберите из активных пользователей"
                  searchable
                  value={memberUserId || null}
                  onChange={(value) => setMemberUserId(value ?? '')}
                  data={(directory.data?.users ?? [])
                    .filter(
                      (candidate) =>
                        candidate.role === 'user' &&
                        !(data.members ?? []).some(
                          (member) => member.id === candidate.id,
                        ),
                    )
                    .map((candidate) => ({
                      value: candidate.id,
                      label: personOptionLabel(candidate),
                    }))}
                  nothingFoundMessage="Все пользователи уже добавлены"
                  required
                />
                <Button type="submit" disabled={!memberUserId}>
                  Добавить на доску
                </Button>
                {directory.isError && (
                  <Text c="red" size="sm" role="alert">
                    Не удалось загрузить список пользователей
                  </Text>
                )}
              </form>
            </Stack>
          </Tabs.Panel>
        )}
      </Tabs>
      {error && <p role="alert">{error}</p>}
    </MantineDrawer>
  );
}
function CreateDepartmentPopover({
  afterCreate,
}: {
  afterCreate: (department: Department) => Promise<void>;
}) {
  const [opened, setOpened] = useState(false),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={280}
      position="bottom-start"
      shadow="md"
    >
      <Popover.Target>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<Plus size={16} />}
          onClick={() => setOpened((value) => !value)}
        >
          Создать отдел
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form
          className="sidebar-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setError('');
            void api<{ department: Department }>('/departments', {
              method: 'POST',
              body: JSON.stringify({ name: name.trim() }),
            })
              .then(async ({ department }) => {
                await afterCreate(department);
                setName('');
                setOpened(false);
              })
              .catch((reason) => setError(err(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <TextInput
            label="Название нового отдела"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            autoFocus
            required
          />
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Создать отдел
          </Button>
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
function RenameDepartmentPopover({
  department,
  afterUpdate,
  afterDelete,
}: {
  department: Department;
  afterUpdate: () => Promise<unknown>;
  afterDelete: (department: Department) => Promise<unknown>;
}) {
  const [opened, setOpened] = useState(false),
    [name, setName] = useState(department.name),
    [confirmDelete, setConfirmDelete] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!opened) {
      setName(department.name);
      setConfirmDelete(false);
      setError('');
    }
  }, [department.name, opened]);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={280}
      position="bottom-start"
      shadow="md"
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Действия отдела ${department.name}`}
          onClick={() => setOpened((value) => !value)}
        >
          <MoreHorizontal size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <form
          className="sidebar-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setError('');
            void api(`/departments/${department.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ name: name.trim() }),
            })
              .then(async () => {
                await afterUpdate();
                setOpened(false);
              })
              .catch((reason) => setError(err(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <TextInput
            label="Новое название отдела"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            autoFocus
            required
          />
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Сохранить отдел
          </Button>
          {!confirmDelete ? (
            <Button
              type="button"
              variant="subtle"
              color="red"
              leftSection={<Trash2 size={15} />}
              onClick={() => setConfirmDelete(true)}
            >
              Удалить отдел
            </Button>
          ) : (
            <div
              className="user-action-panel"
              role="alertdialog"
              aria-labelledby={`delete-department-${department.id}`}
            >
              <strong id={`delete-department-${department.id}`}>
                Удалить отдел «{department.name}»?
              </strong>
              <Text size="xs" c="dimmed">
                Удалить можно только отдел без активных и архивных досок.
              </Text>
              <Group gap="xs" justify="flex-end">
                <Button
                  type="button"
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  autoFocus
                  onClick={() => setConfirmDelete(false)}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  size="compact-sm"
                  color="red"
                  loading={busy}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void api(`/departments/${department.id}`, {
                      method: 'DELETE',
                    })
                      .then(async () => {
                        await afterDelete(department);
                        setOpened(false);
                      })
                      .catch((reason) => setError(err(reason)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Удалить
                </Button>
              </Group>
            </div>
          )}
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
function CreateBoardPopover({
  departments,
  initialDepartmentId,
  afterCreate,
}: {
  departments: Department[];
  initialDepartmentId?: string | null;
  afterCreate: (board: Board) => Promise<void>;
}) {
  const [opened, setOpened] = useState(false),
    [name, setName] = useState(''),
    [departmentId, setDepartmentId] = useState(
      initialDepartmentId ?? departments[0]?.id ?? '',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!departments.some((department) => department.id === departmentId))
      setDepartmentId(initialDepartmentId ?? departments[0]?.id ?? '');
  }, [departmentId, departments, initialDepartmentId]);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={300}
      position="bottom-start"
      shadow="md"
    >
      <Popover.Target>
        <Button
          leftSection={<Plus size={16} />}
          onClick={() => setOpened((value) => !value)}
          disabled={departments.length === 0}
          title={departments.length ? undefined : 'Сначала создайте отдел'}
        >
          Создать доску
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form
          className="sidebar-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !departmentId) return;
            setBusy(true);
            setError('');
            void api<{ board: Board }>('/boards', {
              method: 'POST',
              body: JSON.stringify({
                name: name.trim(),
                departmentId,
              }),
            })
              .then(async ({ board }) => {
                await afterCreate(board);
                setName('');
                setOpened(false);
              })
              .catch((reason) => setError(err(reason)))
              .finally(() => setBusy(false));
          }}
        >
          <TextInput
            label="Название новой доски"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            autoFocus
            required
          />
          <Select
            label="Отдел"
            value={departmentId || null}
            onChange={(value) => setDepartmentId(value ?? '')}
            data={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
            required
          />
          <Button
            type="submit"
            loading={busy}
            disabled={!name.trim() || !departmentId}
          >
            Создать доску
          </Button>
          {error && (
            <Text role="alert" c="red" size="sm">
              {error}
            </Text>
          )}
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}
type BoardGroup = {
  id: string;
  name: string;
  canManage?: boolean;
  boards: Board[];
};
function SidebarContent({
  groups,
  departments,
  selected,
  expanded,
  loading,
  error,
  selectBoard,
  toggleDepartment,
  retry,
  boardCreated,
  departmentCreated,
  departmentsChanged,
  departmentDeleted,
}: {
  groups: BoardGroup[];
  departments: Department[];
  selected: Board | null;
  expanded: Set<string>;
  loading: boolean;
  error: boolean;
  selectBoard: (board: Board) => void;
  toggleDepartment: (id: string) => void;
  retry: () => Promise<unknown>;
  boardCreated: (board: Board) => Promise<void>;
  departmentCreated: (department: Department) => Promise<void>;
  departmentsChanged: () => Promise<unknown>;
  departmentDeleted: (department: Department) => Promise<unknown>;
}) {
  const boardCount = groups.reduce(
    (total, group) => total + group.boards.length,
    0,
  );
  return (
    <div className="sidebar-content">
      <div className="aside-heading">
        <h2>Доски</h2>
        <span>{boardCount}</span>
      </div>
      {loading && groups.length === 0 && (
        <div className="sidebar-state" role="status" aria-live="polite">
          <span className="visually-hidden">Загружаем доски</span>
          <Skeleton height={32} radius="sm" />
          <Skeleton height={32} radius="sm" />
          <Skeleton height={32} radius="sm" />
        </div>
      )}
      {error && (
        <div className="sidebar-error" role="alert">
          <span>Не удалось загрузить доски</span>
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<RefreshCw size={14} />}
            onClick={() => void retry()}
          >
            Повторить
          </Button>
        </div>
      )}
      {!loading && !error && boardCount === 0 && (
        <div className="sidebar-empty">Досок пока нет</div>
      )}
      {groups.length > 0 && (
        <nav aria-label="Доски по отделам">
          {groups.map((group) => {
            const isExpanded = expanded.has(group.id),
              panelId = `department-boards-${group.id}`;
            return (
              <section
                className="department-section"
                data-testid="department-section"
                key={group.id}
              >
                <div className="department-header">
                  <button
                    type="button"
                    className="department-toggle"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    aria-label={`${isExpanded ? 'Свернуть' : 'Развернуть'} отдел ${group.name}`}
                    onClick={() => toggleDepartment(group.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={15} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={15} aria-hidden="true" />
                    )}
                    <strong>{group.name}</strong>
                    <span>{group.boards.length}</span>
                  </button>
                  {group.id !== 'ungrouped' && group.canManage !== false && (
                    <RenameDepartmentPopover
                      department={{
                        id: group.id,
                        name: group.name,
                        canManage: group.canManage,
                      }}
                      afterUpdate={departmentsChanged}
                      afterDelete={departmentDeleted}
                    />
                  )}
                </div>
                <div id={panelId} hidden={!isExpanded}>
                  {group.boards.length === 0 ? (
                    <p className="department-empty">Нет доступных досок</p>
                  ) : (
                    <ul className="department-boards">
                      {group.boards.map((board) => (
                        <li key={board.id}>
                          <button
                            type="button"
                            className={
                              selected?.id === board.id ? 'selected' : ''
                            }
                            aria-current={
                              selected?.id === board.id ? 'page' : undefined
                            }
                            onClick={() => selectBoard(board)}
                            title={board.name}
                          >
                            <Columns3 size={15} aria-hidden="true" />
                            <span>{board.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </nav>
      )}
      <div className="sidebar-actions">
        <CreateBoardPopover
          departments={departments.filter(
            (department) => department.canManage !== false,
          )}
          initialDepartmentId={selected?.departmentId}
          afterCreate={boardCreated}
        />
        <CreateDepartmentPopover afterCreate={departmentCreated} />
      </div>
    </div>
  );
}
function Workspace({
  user,
  logout,
  updateCurrentUser,
}: {
  user: User;
  logout: () => void;
  updateCurrentUser: (user: User) => void;
}) {
  const q = useQueryClient(),
    boards = useQuery<{ boards: Board[] }>({
      queryKey: ['boards'],
      queryFn: () => api('/boards'),
    }),
    departments = useQuery<{ departments: Department[] }>({
      queryKey: ['departments'],
      queryFn: () => api('/departments'),
    }),
    archivedBoards = useQuery<{ boards: Board[] }>({
      queryKey: ['boards', 'archived'],
      queryFn: () => api('/boards?archived=true'),
    }),
    [selected, setSelected] = useState<Board | null>(null),
    [open, setOpen] = useState<Task | null>(null),
    [filter, setFilter] = useState(''),
    [authorFilter, setAuthorFilter] = useState(''),
    [assigneeFilter, setAssigneeFilter] = useState(''),
    [topicFilter, setTopicFilter] = useState(''),
    [labelFilter, setLabelFilter] = useState(''),
    [dueFilter, setDueFilter] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [time, setTime] = useState(false),
    [settings, setSettings] = useState(false),
    [archiveOpen, setArchiveOpen] = useState(false),
    [usersOpen, setUsersOpen] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [mobileSidebarOpen, setMobileSidebarOpen] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(
      () => window.localStorage.getItem('kanban.sidebar-collapsed') === 'true',
    ),
    [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(
      new Set(),
    ),
    knownDepartmentGroups = useRef(new Set<string>()),
    [activeDragId, setActiveDragId] = useState<string | null>(null),
    [moveError, setMoveError] = useState('');
  const groups = useMemo<BoardGroup[]>(() => {
      const allBoards = boards.data?.boards ?? [],
        allDepartments = departments.data?.departments ?? [],
        knownIds = new Set(allDepartments.map((department) => department.id)),
        result = allDepartments.map((department) => ({
          ...department,
          boards: allBoards.filter(
            (boardItem) => boardItem.departmentId === department.id,
          ),
        })),
        ungrouped = allBoards.filter(
          (boardItem) =>
            !boardItem.departmentId || !knownIds.has(boardItem.departmentId),
        );
      if (ungrouped.length)
        result.push({ id: 'ungrouped', name: 'Без отдела', boards: ungrouped });
      return result;
    }, [boards.data?.boards, departments.data?.departments]),
    resetFilters = () => {
      setFilter('');
      setAuthorFilter('');
      setAssigneeFilter('');
      setTopicFilter('');
      setLabelFilter('');
      setDueFilter('');
      setShowArchived(false);
    },
    selectBoard = (next: Board) => {
      const focusBoardTitle = mobileSidebarOpen;
      if (selected?.id !== next.id) resetFilters();
      setSelected(next);
      setOpen(null);
      setMoveError('');
      setMobileSidebarOpen(false);
      const group = groups.find((item) =>
        item.boards.some((boardItem) => boardItem.id === next.id),
      );
      if (group)
        setExpandedDepartments((current) => new Set(current).add(group.id));
      if (focusBoardTitle)
        window.setTimeout(
          () => document.getElementById('board-title')?.focus(),
          220,
        );
    },
    toggleDepartment = (id: string) =>
      setExpandedDepartments((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    window.localStorage.setItem(
      'kanban.sidebar-collapsed',
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);
  useEffect(() => {
    const newGroupIds = groups
      .map((group) => group.id)
      .filter((groupId) => !knownDepartmentGroups.current.has(groupId));
    if (!newGroupIds.length) return;
    for (const groupId of newGroupIds)
      knownDepartmentGroups.current.add(groupId);
    setExpandedDepartments((current) => {
      const next = new Set(current);
      for (const groupId of newGroupIds) next.add(groupId);
      return next;
    });
  }, [groups]);
  useEffect(() => {
    const selectedGroup = groups.find((group) =>
      group.boards.some((boardItem) => boardItem.id === selected?.id),
    );
    if (selectedGroup)
      setExpandedDepartments((current) => {
        if (current.has(selectedGroup.id)) return current;
        return new Set(current).add(selectedGroup.id);
      });
  }, [groups, selected?.id]);
  useEffect(() => {
    const list = boards.data?.boards;
    if (!list) return;
    const current = selected
      ? list.find((boardItem) => boardItem.id === selected.id)
      : undefined;
    if (!current && list.length) selectBoard(list[0]);
    else if (!current) setSelected(null);
    else if (
      current.name !== selected?.name ||
      current.departmentId !== selected?.departmentId
    )
      setSelected(current);
  }, [boards.data?.boards, selected]);
  const board = useQuery<Payload>({
    queryKey: ['board', selected?.id, showArchived],
    queryFn: () =>
      api(
        `/boards/${selected!.id}?archived=${showArchived ? 'true' : 'false'}`,
      ),
    enabled: !!selected,
    refetchInterval: open ? 15000 : false,
  });
  const refresh = async () => {
    await q.invalidateQueries({ queryKey: ['board', selected?.id] });
    await board.refetch();
  };
  const refreshNavigation = async () => {
    await Promise.all([boards.refetch(), departments.refetch()]);
  };
  const boardCreated = async (created: Board) => {
    await boards.refetch();
    if (created.departmentId)
      setExpandedDepartments((current) =>
        new Set(current).add(created.departmentId!),
      );
    selectBoard(created);
  };
  const departmentCreated = async (created: Department) => {
    await departments.refetch();
    setExpandedDepartments((current) => new Set(current).add(created.id));
  };
  const departmentDeleted = async (deleted: Department) => {
    setExpandedDepartments((current) => {
      const next = new Set(current);
      next.delete(deleted.id);
      return next;
    });
    await Promise.all([
      departments.refetch(),
      boards.refetch(),
      archivedBoards.refetch(),
    ]);
  };
  const archiveSelectedBoard = async () => {
    if (!selected) return;
    await api(`/boards/${selected.id}/archive`, { method: 'POST' });
    setSettings(false);
    setOpen(null);
    setSelected(null);
    await Promise.all([boards.refetch(), archivedBoards.refetch()]);
  };
  const restoreBoard = async (archived: Board) => {
    await api(`/boards/${archived.id}/restore`, { method: 'POST' });
    await Promise.all([boards.refetch(), archivedBoards.refetch()]);
    selectBoard(archived);
    setArchiveOpen(false);
  };
  const deleteBoard = async (archived: Board) => {
    await api(`/boards/${archived.id}`, { method: 'DELETE' });
    if (selected?.id === archived.id) {
      setSelected(null);
      setOpen(null);
    }
    await Promise.all([boards.refetch(), archivedBoards.refetch()]);
  };
  const task = useMemo(
    () =>
      open &&
      board.data?.columns.flatMap((c) => c.tasks).find((x) => x.id === open.id),
    [open, board.data],
  );
  const activeDragTask = useMemo(
      () =>
        activeDragId
          ? (board.data?.columns
              .flatMap((column) => column.tasks)
              .find((item) => item.id === activeDragId) ?? null)
          : null,
      [activeDragId, board.data],
    ),
    textAssignees = useMemo(
      () =>
        [
          ...new Set(
            (board.data?.columns ?? [])
              .flatMap((column) => column.tasks)
              .map((taskItem) => taskItem.assigneeName?.trim())
              .filter((name): name is string => Boolean(name)),
          ),
        ].sort((left, right) => left.localeCompare(right, 'ru')),
      [board.data?.columns],
    ),
    assigneeFilterData = [
      {
        group: 'Участники доски',
        items: (board.data?.members ?? []).map((member) => ({
          value: userAssigneeKey(member.id),
          label: personOptionLabel(member),
        })),
      },
      {
        group: 'Произвольные имена',
        items: textAssignees.map((name) => ({
          value: textAssigneeKey(name),
          label: name,
        })),
      },
    ].filter((group) => group.items.length > 0);
  const authorFilterData = Array.from(
    new Map(
      [
        ...(board.data?.members ?? []),
        ...(board.data?.columns ?? [])
          .flatMap((column) => column.tasks)
          .flatMap((taskItem) => (taskItem.author ? [taskItem.author] : [])),
      ].map((person) => [
        person.id,
        { value: person.id, label: personOptionLabel(person) },
      ]),
    ).values(),
  );
  const visible = (t: Task) => {
    const text =
      !filter ||
      t.title.toLowerCase().includes(filter.toLowerCase()) ||
      t.description.toLowerCase().includes(filter.toLowerCase());
    const due =
      !dueFilter ||
      (dueFilter === 'overdue'
        ? !!t.dueAt && new Date(t.dueAt) < new Date()
        : !!t.dueAt);
    return (
      text &&
      (!authorFilter || t.authorId === authorFilter) &&
      (!assigneeFilter ||
        (assigneeFilter.startsWith('user:')
          ? t.assigneeId === assigneeFilter.slice(5)
          : assigneeFilter.startsWith('text:') &&
            !t.assigneeId &&
            t.assigneeName === assigneeFilter.slice(5))) &&
      (!topicFilter || t.topicId === topicFilter) &&
      (!labelFilter ||
        Boolean(t.labels?.some((label) => label.id === labelFilter))) &&
      due
    );
  };
  const activeFilterCount = [
    authorFilter,
    assigneeFilter,
    topicFilter,
    labelFilter,
    dueFilter,
    showArchived ? 'archived' : '',
  ].filter(Boolean).length;
  const canManage = Boolean(board.data);
  const moveTask = async ({ active, over }: DragEndEvent) => {
    if (!over || !board.data || !selected) return;
    const taskId = String(active.id),
      sourceColumn = board.data.columns.find((column) =>
        column.tasks.some((item) => item.id === taskId),
      ),
      task = sourceColumn?.tasks.find((item) => item.id === taskId),
      targetColumnId = String(over.data.current?.columnId ?? ''),
      targetColumn = board.data.columns.find(
        (column) => column.id === targetColumnId,
      );
    if (!sourceColumn || !task || !targetColumn) return;

    const destination = targetColumn.tasks.filter((item) => item.id !== taskId);
    let insertAt = destination.length;
    if (over.data.current?.type === 'task') {
      const overIndex = destination.findIndex(
        (item) => item.id === String(over.id),
      );
      if (overIndex >= 0) {
        const translated = active.rect.current.translated,
          below =
            !!translated &&
            translated.top > over.rect.top + over.rect.height / 2;
        insertAt = overIndex + (below ? 1 : 0);
      }
    }
    const beforeTaskId = destination[insertAt]?.id ?? null,
      nextDestination = [...destination];
    nextDestination.splice(insertAt, 0, { ...task, columnId: targetColumnId });
    if (
      sourceColumn.id === targetColumnId &&
      sourceColumn.tasks.map((item) => item.id).join() ===
        nextDestination.map((item) => item.id).join()
    )
      return;

    const snapshot = board.data,
      optimistic: Payload = {
        ...snapshot,
        columns: snapshot.columns.map((column) => {
          if (column.id === targetColumnId)
            return { ...column, tasks: nextDestination };
          if (column.id === sourceColumn.id)
            return {
              ...column,
              tasks: column.tasks.filter((item) => item.id !== taskId),
            };
          return column;
        }),
      };
    setMoveError('');
    q.setQueryData(['board', selected.id, showArchived], optimistic);
    try {
      await api(`/boards/${selected.id}/tasks/${taskId}/move`, {
        method: 'POST',
        body: JSON.stringify({ columnId: targetColumnId, beforeTaskId }),
      });
      await q.invalidateQueries({ queryKey: ['board', selected.id] });
    } catch (error) {
      q.setQueryData(['board', selected.id, showArchived], snapshot);
      setMoveError(err(error));
    }
  };
  const sidebar = (
    <SidebarContent
      groups={groups}
      departments={departments.data?.departments ?? []}
      selected={selected}
      expanded={expandedDepartments}
      loading={boards.isLoading || departments.isLoading}
      error={boards.isError || departments.isError}
      selectBoard={selectBoard}
      toggleDepartment={toggleDepartment}
      retry={() => Promise.all([boards.refetch(), departments.refetch()])}
      boardCreated={boardCreated}
      departmentCreated={departmentCreated}
      departmentsChanged={() => departments.refetch()}
      departmentDeleted={departmentDeleted}
    />
  );
  return (
    <main
      className={`workspace${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      data-testid="workspace"
    >
      <header data-testid="app-header">
        <ActionIcon
          className="mobile-sidebar-trigger"
          data-testid="mobile-sidebar-trigger"
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Открыть меню досок"
          aria-expanded={mobileSidebarOpen}
          onClick={() => setMobileSidebarOpen(true)}
        >
          <MenuIcon size={20} />
        </ActionIcon>
        <div className="brand" aria-label="ТФОМС Югры — Канбан">
          <img src="/tfoms-yugra-logo.png" alt="" width="38" height="34" />
          <b>Канбан</b>
        </div>
        <span data-testid="user-email" className="visually-hidden">
          {user.email}
        </span>
        <NotificationBell />
        <UserMenu
          user={user}
          logout={logout}
          openArchivedBoards={() => setArchiveOpen(true)}
          openUsers={() => setUsersOpen(true)}
          openProfile={() => setProfileOpen(true)}
        />
      </header>
      <aside className="workspace-sidebar" data-testid="desktop-sidebar">
        <div className="sidebar-toolbar">
          <ActionIcon
            data-testid="sidebar-collapse"
            variant="subtle"
            color="gray"
            size="lg"
            aria-label={
              sidebarCollapsed
                ? 'Развернуть боковую панель'
                : 'Свернуть боковую панель'
            }
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={19} />
            ) : (
              <ChevronLeft size={19} />
            )}
          </ActionIcon>
        </div>
        {!sidebarCollapsed && sidebar}
      </aside>
      <MantineDrawer
        opened={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        position="left"
        size="min(320px, 88vw)"
        title="Доски"
        classNames={{ content: 'mobile-sidebar', body: 'mobile-sidebar-body' }}
        data-testid="mobile-sidebar"
      >
        {sidebar}
      </MantineDrawer>
      <section className="area">
        {(boards.isLoading || departments.isLoading) && !selected && (
          <div className="workspace-state" role="status">
            <Skeleton height={24} width={220} />
            <Skeleton height={180} />
            <span className="visually-hidden">
              Загружаем рабочее пространство
            </span>
          </div>
        )}
        {(boards.isError || departments.isError) && !selected && (
          <div className="workspace-state" role="alert">
            <strong>Не удалось загрузить рабочее пространство</strong>
            <Button
              variant="light"
              leftSection={<RefreshCw size={16} />}
              onClick={() =>
                void Promise.all([boards.refetch(), departments.refetch()])
              }
            >
              Повторить
            </Button>
          </div>
        )}
        {!boards.isLoading && !boards.isError && !selected && (
          <div className="workspace-state empty-state">
            <strong>Досок пока нет</strong>
            <span>Создайте первую доску в боковом меню.</span>
          </div>
        )}
        {selected && board.isLoading && !board.data && (
          <div className="workspace-state" role="status">
            <Skeleton height={24} width={220} />
            <Skeleton height={180} />
            <span className="visually-hidden">Загружаем доску</span>
          </div>
        )}
        {selected && board.isError && !board.data && (
          <div className="workspace-state" role="alert">
            <strong>Не удалось загрузить доску</strong>
            <Button
              variant="light"
              leftSection={<RefreshCw size={16} />}
              onClick={() => void board.refetch()}
            >
              Повторить
            </Button>
          </div>
        )}
        {selected && board.data && (
          <>
            <div className="board-heading" data-testid="board-toolbar">
              <div>
                <span className="eyebrow">Рабочая доска</span>
                <h1 id="board-title" tabIndex={-1}>
                  {board.data.board.name}
                </h1>
              </div>
              <div className="board-actions">
                <Button
                  variant="default"
                  leftSection={<Clock3 size={17} />}
                  onClick={() => setTime(true)}
                >
                  Учёт времени
                </Button>
                {canManage && (
                  <>
                    <AddColumn boardId={selected.id} refresh={refresh} />
                    <Button
                      variant="default"
                      leftSection={<SettingsIcon size={17} />}
                      onClick={() => setSettings(true)}
                    >
                      Настроить доску
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="filters" aria-label="Фильтры задач">
              <TextInput
                className="board-search"
                aria-label="Поиск задач"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Поиск по задачам"
                leftSection={<Search size={16} />}
              />
              <Popover width={340} position="bottom-start" shadow="md">
                <Popover.Target>
                  <Button variant="default" leftSection={<Filter size={16} />}>
                    Фильтры{activeFilterCount ? ` · ${activeFilterCount}` : ''}
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={700} size="sm">
                        Фильтры задач
                      </Text>
                      {activeFilterCount > 0 && (
                        <Button
                          variant="subtle"
                          size="compact-sm"
                          onClick={resetFilters}
                        >
                          Сбросить
                        </Button>
                      )}
                    </Group>
                    <Select
                      label="Автор"
                      placeholder="Все авторы"
                      clearable
                      searchable
                      value={authorFilter || null}
                      onChange={(value) => setAuthorFilter(value ?? '')}
                      data={authorFilterData}
                    />
                    <Select
                      label="Исполнитель"
                      placeholder="Все исполнители"
                      clearable
                      searchable
                      value={assigneeFilter || null}
                      onChange={(value) => setAssigneeFilter(value ?? '')}
                      data={assigneeFilterData}
                    />
                    <div className="filter-grid">
                      <Select
                        label="Тема"
                        placeholder="Все темы"
                        clearable
                        value={topicFilter || null}
                        onChange={(value) => setTopicFilter(value ?? '')}
                        data={(board.data.topics ?? []).map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                      />
                      <Select
                        label="Метка"
                        placeholder="Все метки"
                        clearable
                        value={labelFilter || null}
                        onChange={(value) => setLabelFilter(value ?? '')}
                        data={(board.data.labels ?? []).map((item) => ({
                          value: item.id,
                          label: item.name,
                        }))}
                      />
                    </div>
                    <Select
                      label="Срок"
                      placeholder="Любой срок"
                      clearable
                      value={dueFilter || null}
                      onChange={(value) => setDueFilter(value ?? '')}
                      data={[
                        { value: 'due', label: 'Со сроком' },
                        { value: 'overdue', label: 'Просроченные' },
                      ]}
                    />
                    <Checkbox
                      label="Показывать архивные задачи"
                      checked={showArchived}
                      onChange={(event) =>
                        setShowArchived(event.currentTarget.checked)
                      }
                    />
                  </Stack>
                </Popover.Dropdown>
              </Popover>
              {activeFilterCount > 0 && (
                <div className="active-filter-summary" aria-live="polite">
                  <Badge variant="light">Активно: {activeFilterCount}</Badge>
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={resetFilters}
                  >
                    Сбросить
                  </Button>
                </div>
              )}
            </div>
            {moveError && <p role="alert">{moveError}</p>}
            <DndContext
              sensors={sensors}
              collisionDetection={taskCollisionDetection}
              onDragStart={({ active }) => setActiveDragId(String(active.id))}
              onDragCancel={() => setActiveDragId(null)}
              onDragEnd={(event) => {
                setActiveDragId(null);
                void moveTask(event);
              }}
            >
              <div className="board" data-testid="board-scroll">
                {board.data.columns.map((column) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    data={board.data}
                    boardId={selected.id}
                    canManage={Boolean(canManage)}
                    visible={visible}
                    open={setOpen}
                    refresh={refresh}
                  />
                ))}
              </div>
              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {activeDragTask ? (
                    <CardDragPreview task={activeDragTask} data={board.data} />
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </>
        )}
      </section>
      {board.data && task && (
        <TaskDrawer
          data={board.data}
          task={task}
          close={() => setOpen(null)}
          refresh={refresh}
        />
      )}{' '}
      {selected && time && board.data && (
        <TimeView data={board.data} close={() => setTime(false)} />
      )}
      {settings && board.data && (
        <Settings
          data={board.data}
          currentUser={user}
          departments={departments.data?.departments ?? []}
          close={() => setSettings(false)}
          refresh={refresh}
          refreshNavigation={refreshNavigation}
          archiveBoard={archiveSelectedBoard}
        />
      )}
      {archiveOpen && (
        <ArchivedBoardsDrawer
          boards={archivedBoards.data?.boards ?? []}
          close={() => setArchiveOpen(false)}
          restore={restoreBoard}
          destroy={deleteBoard}
        />
      )}
      {usersOpen && user.role !== 'user' && (
        <AdminUsersDrawer
          currentUser={user}
          departments={departments.data?.departments ?? []}
          boards={[
            ...(boards.data?.boards ?? []),
            ...(archivedBoards.data?.boards ?? []),
          ]}
          updateCurrentUser={updateCurrentUser}
          close={() => setUsersOpen(false)}
        />
      )}
      {profileOpen && (
        <ProfileDrawer
          user={user}
          updateCurrentUser={updateCurrentUser}
          close={() => setProfileOpen(false)}
        />
      )}
    </main>
  );
}
function App() {
  const [u, setU] = useState<User | null>(null),
    me = useQuery<{ user: User }>({
      queryKey: ['me'],
      queryFn: () => api('/auth/me'),
      retry: false,
    });
  useEffect(() => {
    if (me.data) setU(me.data.user);
  }, [me.data]);
  if (me.isLoading) return <main className="loading">Загрузка…</main>;
  return u ? (
    <Workspace
      user={u}
      updateCurrentUser={setU}
      logout={async () => {
        await api('/auth/sign-out', { method: 'POST' });
        setU(null);
      }}
    />
  ) : (
    <Login done={setU} />
  );
}
createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} defaultColorScheme="auto">
    <DatesProvider settings={{ locale: 'ru', firstDayOfWeek: 1 }}>
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>
    </DatesProvider>
  </MantineProvider>,
);
