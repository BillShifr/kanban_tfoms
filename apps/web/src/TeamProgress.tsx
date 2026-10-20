import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
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
import { ArrowUpRight, Check, ChevronRight, UserRound } from 'lucide-react';

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
  monthCreated: number;
  monthCompleted: number;
  rank: number | null;
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
    art: 'initiative',
  },
  {
    title: 'Довести до результата',
    description: 'Завершить первую задачу',
    key: 'completed' as const,
    goal: 1,
    art: 'result',
  },
  {
    title: 'Надёжное плечо',
    description: 'Завершить 10 задач',
    key: 'completed' as const,
    goal: 10,
    art: 'bridge',
  },
  {
    title: 'Мастер результата',
    description: 'Завершить 50 задач',
    key: 'completed' as const,
    goal: 50,
    art: 'summit',
  },
];

function Achievements({ person }: { person: Contributor }) {
  const [selected, setSelected] = useState<(typeof milestones)[number] | null>(
    null,
  );
  return (
    <>
      <div className="achievement-grid">
        {milestones.map((milestone) => {
          const { title, description, key, goal, art } = milestone;
          const earned = person[key] >= goal;
          return (
            <button
              type="button"
              onClick={() => setSelected(milestone)}
              className={`achievement ${earned ? 'earned' : ''}`}
              key={title}
            >
              <img
                src={`/achievements/${art}.png`}
                alt=""
                width={100}
                height={100}
              />
              <strong>{title}</strong>
              <small>{description}</small>
              <Progress
                value={Math.min(100, (person[key] / goal) * 100)}
                aria-label={`${title}: ${person[key]} из ${goal}`}
              />
              <span>
                {earned ? 'Достигнуто' : `${person[key]} / ${goal}`} · Подробнее
              </span>
            </button>
          );
        })}
      </div>
      <Modal
        opened={!!selected}
        onClose={() => setSelected(null)}
        title="Условие достижения"
        centered
        size={440}
      >
        {selected && (
          <div className="achievement-detail">
            <img
              src={`/achievements/${selected.art}.png`}
              alt=""
              width={160}
              height={160}
            />
            <h2>{selected.title}</h2>
            <p>{selected.description}</p>
            <strong>
              {person[selected.key]} из {selected.goal} ·{' '}
              {person[selected.key] >= selected.goal
                ? 'Достигнуто'
                : 'В процессе'}
            </strong>
            <p>
              За всё время учёта в выбранной области. Возврат задачи в работу,
              удаление или изменение доступа могут изменить прогресс. Сам значок
              не добавляет баллов.
            </p>
          </div>
        )}
      </Modal>
    </>
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
  profileOpen,
  closeProfile,
}: {
  user: Member;
  updateUser: (user: Member) => void;
  request: Request;
  profileOpen: boolean;
  closeProfile: () => void;
}) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.query.queryKey[0] === 'board'
        ) {
          void queryClient.invalidateQueries({
            queryKey: ['progress', user.id],
          });
        }
      }),
    [queryClient, user.id],
  );
  const [opened, setOpened] = useState(false);
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
  const data = progress.data;
  const period = data
    ? new Intl.DateTimeFormat('ru-RU', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${data.period}-01T00:00:00Z`))
    : 'Текущий месяц';
  const scopeControl = (
    <SegmentedControl
      fullWidth
      aria-label="Область рейтинга"
      value={scope}
      onChange={(value) => setScope(value as 'visible' | 'global')}
      data={[
        { value: 'visible', label: 'Доступные доски' },
        { value: 'global', label: 'Все сотрудники' },
      ]}
    />
  );
  const loadState = progress.isError ? (
    <div className="team-load-state">
      <Text size="sm" role="alert">
        {data
          ? 'Не удалось обновить данные. Показан предыдущий результат.'
          : 'Не удалось загрузить достижения.'}
      </Text>
      <Button size="xs" variant="light" onClick={() => void progress.refetch()}>
        Повторить
      </Button>
    </div>
  ) : !data ? (
    <Text role="status" size="sm">
      Загружаем вклад команды…
    </Text>
  ) : null;
  const next = data && milestones.find((m) => data.me[m.key] < m.goal);
  const leaders = (limit: number) =>
    data && (
      <ol className="leader-list">
        {data.leaders.slice(0, limit).map((person) => (
          <li key={person.id} className={person.id === user.id ? 'is-me' : ''}>
            <span className="leader-position">{person.rank ?? '—'}</span>
            <Avatar
              size={32}
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
              <strong title={name(person)}>
                {name(person)}
                {person.id === user.id ? ' · вы' : ''}
              </strong>
              <small>{person.monthCompleted} завершено за месяц</small>
            </div>
            <b>
              {person.points}
              <small>баллов</small>
            </b>
          </li>
        ))}
      </ol>
    );
  return (
    <>
      <aside className="team-rail" aria-label="Команда и достижения">
        <div className="team-rail-heading">
          <span className="eyebrow">ВМЕСТЕ К РЕЗУЛЬТАТУ</span>
          <h2>Команда и достижения</h2>
          <p>{period} · UTC</p>
        </div>
        {scopeControl}
        {loadState}
        {data && (
          <>
            <section className="team-score" aria-label="Ваш результат">
              <span>Ваш вклад за месяц</span>
              <div className="team-score-number">
                <strong>{data.me.points}</strong>
                <span>баллов</span>
                <ArrowUpRight size={28} />
              </div>
              <div className="team-score-breakdown">
                <span>
                  <b>{data.me.monthCreated}</b> создано × 2
                </span>
                <span>
                  <b>{data.me.monthCompleted}</b> завершено × 10
                </span>
              </div>
              <p>
                {data.me.rank
                  ? `Место ${data.me.rank} из ${data.participants}`
                  : 'Первое место в рейтинге начинается с первого действия'}
              </p>
            </section>
            <button
              className="next-achievement"
              type="button"
              onClick={() => setOpened(true)}
            >
              <img
                src={`/achievements/${next ? next.art : 'summit'}.png`}
                alt=""
                width={78}
                height={78}
              />
              <span>
                <small>{next ? 'БЛИЖАЙШАЯ ЦЕЛЬ' : 'КОЛЛЕКЦИЯ СОБРАНА'}</small>
                <strong>{next ? next.title : 'Все четыре достижения'}</strong>
                <span>
                  {next
                    ? `${data.me[next.key]} / ${next.goal} · ${next.description}`
                    : 'Посмотреть свои результаты'}
                </span>
              </span>
              <ChevronRight size={16} />
            </button>
            <section className="team-leaders">
              <div className="team-section-title">
                <h3>Лидеры месяца</h3>
                <span>{data.participants} участников</span>
              </div>
              {!data.leaders.length && (
                <p className="team-empty">
                  Первый результат ещё впереди. Создайте задачу или завершите
                  назначенную.
                </p>
              )}
              {leaders(3)}
            </section>
          </>
        )}
        <Button
          className="team-open"
          variant="default"
          rightSection={<ArrowUpRight size={16} />}
          onClick={() => setOpened(true)}
        >
          Рейтинг и достижения
        </Button>
        <p className="team-footnote">
          Признание вклада, не оценка труда.
          <br />
          Только агрегаты — без закрытых задач.
        </p>
      </aside>
      <button
        type="button"
        className="team-mobile-bar"
        onClick={() => setOpened(true)}
      >
        <img src="/achievements/initiative.png" alt="" width={32} height={32} />
        <span>
          <strong>Команда и достижения</strong>
          <small>
            {data
              ? `${data.me.points} баллов за месяц · ${data.scope}`
              : 'Посмотреть рейтинг и условия'}
          </small>
        </span>
        <ChevronRight size={18} />
      </button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        size={760}
        centered
        title="Команда и достижения"
        classNames={{ content: 'team-dialog' }}
      >
        {scopeControl}
        <Text size="sm" c="dimmed" my="md">
          {scope === 'global'
            ? 'Общий вклад сотрудников без раскрытия задач и закрытых досок.'
            : 'Вклад в доски, к которым у вас есть доступ.'}
        </Text>
        {loadState}
        {data && (
          <>
            <div className="team-personal-strip">
              <Check size={20} />
              <strong>Ваш результат: {data.me.points} баллов</strong>
              <span>
                {data.me.rank ? `Место ${data.me.rank}` : 'Пока без места'} ·{' '}
                {period}
              </span>
            </div>
            <section className="team-collection">
              <h2>Ваша коллекция</h2>
              <p>
                За всё время учёта · {data.scope}. Нажмите на значок, чтобы
                узнать условие.
              </p>
              <Achievements person={data.me} />
            </section>
            <section className="team-leaders">
              <h2>Рейтинг месяца</h2>
              <p>
                Первые 20 участников · {data.participants} всего. Одинаковые
                баллы — одинаковое место.
              </p>
              {!progress.data.leaders.length && (
                <Text>
                  Первый результат ещё впереди. Создайте задачу или завершите
                  назначенную.
                </Text>
              )}
              {leaders(20)}
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
                При повторном закрытии возвращается исходное событие в его
                исходный месяц. Смена исполнителя после закрытия не передаёт
                баллы. Архивные доски и архивные учётные записи не участвуют;
                восстановление доски возвращает её события.
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
      </Modal>
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
          closeProfile();
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
