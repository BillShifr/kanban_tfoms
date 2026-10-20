import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  FileInput,
  Group,
  Modal,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Award, Flag, Sparkles, Target, Trophy, UserRound } from 'lucide-react';

type Member = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: 'superadmin' | 'admin' | 'user';
};
type Contributor = Member & {
  points: number;
  created: number;
  completed: number;
  hasAvatar: boolean;
};
type ProgressData = {
  leaders: Contributor[];
  me: Contributor;
  scope: string;
  period: string;
  participants: number;
};
type Profile = { user: Member; bio: string; hasAvatar: boolean };
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
const name = (u: Member) =>
  [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email;
const milestones = [
  {
    title: 'Первый шаг',
    description: 'Создать первую задачу',
    key: 'created' as const,
    goal: 1,
    icon: Flag,
    tone: 'blue',
  },
  {
    title: 'Довести до результата',
    description: 'Завершить первую задачу',
    key: 'completed' as const,
    goal: 1,
    icon: Target,
    tone: 'green',
  },
  {
    title: 'Надёжное плечо',
    description: 'Завершить 10 задач',
    key: 'completed' as const,
    goal: 10,
    icon: Award,
    tone: 'violet',
  },
  {
    title: 'Мастер результата',
    description: 'Завершить 50 задач',
    key: 'completed' as const,
    goal: 50,
    icon: Trophy,
    tone: 'amber',
  },
];

function Achievements({ person }: { person: Contributor }) {
  return (
    <div className="achievement-grid">
      {milestones.map(({ title, description, key, goal, icon: Icon, tone }) => {
        const earned = person[key] >= goal;
        return (
          <div className={`achievement ${earned ? 'earned' : ''}`} key={title}>
            <span className={`achievement-medal ${tone}`}>
              <Icon size={24} strokeWidth={1.8} />
            </span>
            <strong>{title}</strong>
            <small>{description}</small>
            <Progress
              value={Math.min(100, (person[key] / goal) * 100)}
              aria-label={`${title}: ${person[key]} из ${goal}`}
            />
            <span>{earned ? 'Достигнуто' : `${person[key]} / ${goal}`}</span>
          </div>
        );
      })}
    </div>
  );
}

async function prepareAvatar(file: File): Promise<Blob> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Выберите PNG, JPEG или WebP до 10 МБ.');
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать изображение.');
    const side = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Не удалось подготовить аватар.')),
        'image/jpeg',
        0.85,
      ),
    );
  } finally {
    image.close();
  }
}

function ProfileForm({
  profile,
  request,
  updateUser,
  refresh,
  onDirtyChange,
  onBusyChange,
}: {
  profile: Profile;
  request: Request;
  updateUser: (user: Member) => void;
  refresh: () => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [firstName, setFirstName] = useState(profile.user.firstName ?? '');
  const [lastName, setLastName] = useState(profile.user.lastName ?? '');
  const [bio, setBio] = useState(profile.bio);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [avatarVersion, setAvatarVersion] = useState(0);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refresh();
      setAvatarVersion((v) => v + 1);
      setMessage('Изменения сохранены');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <Stack>
      <Group>
        <Avatar
          size={76}
          radius={24}
          src={
            profile.hasAvatar
              ? `/api/profile/avatar/${profile.user.id}?v=${avatarVersion}`
              : undefined
          }
        >
          <UserRound size={32} />
        </Avatar>
        <div className="profile-upload">
          <FileInput
            label="Аватар"
            placeholder="Загрузить фото"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(file) => {
              if (file)
                void run(async () => {
                  const body = new FormData();
                  body.append(
                    'avatar',
                    await prepareAvatar(file),
                    'avatar.jpg',
                  );
                  await request('/profile/avatar', { method: 'POST', body });
                });
            }}
          />
          <Text size="xs" c="dimmed">
            Квадратное фото; PNG, JPEG, WebP. До 10 МБ.
          </Text>
        </div>
        {profile.hasAvatar && (
          <Button
            variant="subtle"
            color="red"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request('/profile/avatar', { method: 'DELETE' });
              })
            }
          >
            Удалить фото
          </Button>
        )}
      </Group>
      <form
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await request<{ user: Member }>('/profile', {
              method: 'PATCH',
              body: JSON.stringify({ firstName, lastName, bio }),
            });
            updateUser(result.user);
            onDirtyChange(false);
          });
        }}
      >
        <TextInput
          label="Фамилия"
          disabled={busy}
          value={lastName}
          maxLength={80}
          onChange={(e) => {
            setLastName(e.target.value);
            onDirtyChange(true);
          }}
        />
        <TextInput
          label="Имя"
          disabled={busy}
          value={firstName}
          maxLength={80}
          onChange={(e) => {
            setFirstName(e.target.value);
            onDirtyChange(true);
          }}
        />
        <TextInput
          label="Email для входа"
          value={profile.user.email}
          readOnly
          description="Адрес и права учётной записи меняет администратор."
        />
        <Textarea
          label="О себе"
          disabled={busy}
          placeholder="Чем вы помогаете команде"
          value={bio}
          maxLength={240}
          onChange={(e) => {
            setBio(e.target.value);
            onDirtyChange(true);
          }}
        />
        <Button type="submit" loading={busy}>
          Сохранить профиль
        </Button>
      </form>
      {error && (
        <Text c="red" role="alert">
          {error}
        </Text>
      )}
      {message && <Text role="status">{message}</Text>}
    </Stack>
  );
}

export function TeamProgress({
  user,
  updateUser,
  request,
}: {
  user: Member;
  updateUser: (user: Member) => void;
  request: Request;
}) {
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [scope, setScope] = useState<'visible' | 'global'>('visible');
  const progress = useQuery<ProgressData>({
    queryKey: ['progress', user.id, scope],
    queryFn: () => request(`/progress?scope=${scope}`),
    refetchInterval: 60000,
  });
  const profile = useQuery<Profile>({
    queryKey: ['profile', user.id],
    queryFn: () => request('/profile'),
    enabled: profileOpen,
  });
  const refresh = () =>
    Promise.all([
      profile.refetch(),
      queryClient.invalidateQueries({ queryKey: ['progress'] }),
      queryClient.invalidateQueries({ queryKey: ['board'] }),
    ]);
  return (
    <>
      <div className="progress-header">
        <Button
          className="pulse-button"
          variant="light"
          leftSection={<Sparkles size={18} />}
          onClick={() => {
            setOpened(true);
            void progress.refetch();
          }}
        >
          Пульс команды <b>{progress.data?.me.points ?? '—'}</b>
        </Button>
        <Button
          variant="subtle"
          leftSection={<UserRound size={18} />}
          onClick={() => setProfileOpen(true)}
        >
          Мой профиль
        </Button>
      </div>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        position="right"
        size={460}
        title="Пульс команды"
        classNames={{ content: 'progress-drawer' }}
      >
        <SegmentedControl
          fullWidth
          mb="md"
          aria-label="Область рейтинга"
          value={scope}
          onChange={(value) => setScope(value as 'visible' | 'global')}
          data={[
            { value: 'visible', label: 'Доступные доски' },
            { value: 'global', label: 'Все сотрудники' },
          ]}
        />
        <Text size="xs" c="dimmed" mb="md">
          {scope === 'global'
            ? 'Общий вклад сотрудников без раскрытия задач и закрытых досок.'
            : 'Вклад в доски, к которым у вас есть доступ.'}
        </Text>
        {progress.isError ? (
          <Stack>
            <Text role="alert">Не удалось загрузить прогресс</Text>
            <Button onClick={() => void progress.refetch()}>Повторить</Button>
          </Stack>
        ) : !progress.data ? (
          <Text>Загружаем вклад команды…</Text>
        ) : (
          <>
            <section className="pulse-hero">
              <span className="eyebrow">
                ВКЛАД ЗА МЕСЯЦ · {progress.data.period}
              </span>
              <div>
                <strong>{progress.data.me.points}</strong>
                <span>
                  баллов
                  <br />
                  вашего вклада
                </span>
                <Sparkles size={42} />
              </div>
              <p>
                {progress.data.scope} · Участников: {progress.data.participants}
              </p>
            </section>
            <section className="pulse-section">
              <h2>Лидеры месяца</h2>
              <p>{progress.data.scope}. Это вклад, не оценка труда.</p>
              {!progress.data.leaders.length && (
                <Text>
                  Первый результат ещё впереди. Создайте задачу или завершите
                  назначенную.
                </Text>
              )}
              <ol className="leader-list">
                {progress.data.leaders.map((person, i) => (
                  <li
                    key={person.id}
                    className={person.id === user.id ? 'is-me' : ''}
                  >
                    <span className="leader-position">{i + 1}</span>
                    <Avatar
                      radius="xl"
                      src={
                        person.hasAvatar
                          ? `/api/profile/avatar/${person.id}`
                          : undefined
                      }
                    >
                      {name(person).slice(0, 1)}
                    </Avatar>
                    <div>
                      <strong>{name(person)}</strong>
                      <small>
                        Завершено: {person.completed} · Наград:{' '}
                        {
                          milestones.filter((m) => person[m.key] >= m.goal)
                            .length
                        }
                      </small>
                    </div>
                    <b>{person.points}</b>
                  </li>
                ))}
              </ol>
            </section>
            <section className="pulse-section">
              <h2>Ваши ориентиры</h2>
              <Achievements person={progress.data.me} />
            </section>
            <details className="progress-rules">
              <summary>Как начисляются баллы</summary>
              <p>
                +2 автору за создание, +10 назначенному исполнителю за первое
                завершение. Завершением считается перенос в последнюю колонку
                доски.
              </p>
              <p>
                Повторное закрытие не даёт новых баллов. При возврате в работу
                баллы завершения не учитываются до следующего закрытия.
                Удалённые задачи не учитываются. Без назначенной учётной записи
                баллы завершения не выдаются.
              </p>
              <p>
                Учёт начат с обновления; старые создания не восстановлены задним
                числом. Месяц считается по UTC. Достижения считаются за всё
                время учёта в выбранной области рейтинга; при изменении доступа
                или отмене результата они могут измениться.
              </p>
            </details>
          </>
        )}
      </Drawer>
      <Modal
        opened={profileOpen}
        onClose={() => {
          if (profileBusy) return;
          if (
            profileDirty &&
            !window.confirm('Закрыть профиль без сохранения изменений?')
          )
            return;
          setProfileDirty(false);
          setProfileOpen(false);
        }}
        title="Мой профиль"
        centered
        size={680}
      >
        {profile.isError ? (
          <Stack>
            <Text role="alert">Не удалось загрузить профиль</Text>
            <Button onClick={() => void profile.refetch()}>Повторить</Button>
          </Stack>
        ) : profile.data ? (
          <Stack gap="xl">
            <ProfileForm
              profile={profile.data}
              request={request}
              updateUser={updateUser}
              refresh={refresh}
              onDirtyChange={setProfileDirty}
              onBusyChange={setProfileBusy}
            />
            {progress.data && (
              <section>
                <Group justify="space-between">
                  <h2>Мои достижения</h2>
                  <Badge>{progress.data.me.points} баллов за месяц</Badge>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  {progress.data.scope}
                </Text>
                <Achievements person={progress.data.me} />
              </section>
            )}
          </Stack>
        ) : (
          <Text>Загружаем профиль…</Text>
        )}
      </Modal>
    </>
  );
}
