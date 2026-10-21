import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Tabs,
} from '@mantine/core';
import { ChevronRight, UserRound } from 'lucide-react';
import { RewardAvatar } from './RewardAvatar';
import {
  PointCelebration,
  RewardWardrobe,
  type PointEvent,
  type RewardsData,
} from './Rewards';

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
  frame?: string;
  winnerPlace?: number | null;
};
type ProgressData = {
  leaders: Contributor[];
  me: Contributor;
  scope: string;
  period: string;
  participants: number;
  rewards: RewardsData;
  recentEvents: PointEvent[];
};
type Profile = { user: Member; bio: string; hasAvatar: boolean };
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
const name = (u: Member) =>
  [u.lastName, u.firstName].filter(Boolean).join(' ') || u.email;
const gameDialogClasses = {
  content: 'team-dialog',
  header: 'team-dialog-header',
  title: 'team-dialog-title',
  close: 'team-dialog-close',
};
const milestones = [
  {
    title: 'Первый шаг',
    description: 'Создать первую задачу',
    key: 'created' as const,
    goal: 1,
    art: 'initiative',
  },
  {
    title: 'Верный курс',
    description: 'Создать 10 задач',
    key: 'created' as const,
    goal: 10,
    art: 'navigator',
  },
  {
    title: 'Архитектор',
    description: 'Создать 50 задач',
    key: 'created' as const,
    goal: 50,
    art: 'architect',
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
    title: 'Созвездие',
    description: 'Завершить 25 задач',
    key: 'completed' as const,
    goal: 25,
    art: 'constellation',
  },
  {
    title: 'Мастер результата',
    description: 'Завершить 50 задач',
    key: 'completed' as const,
    goal: 50,
    art: 'summit',
  },
  {
    title: 'На орбите',
    description: 'Завершить 100 задач',
    key: 'completed' as const,
    goal: 100,
    art: 'orbit',
  },
];

function Achievements({
  person,
  rewards,
}: {
  person: Contributor;
  rewards: RewardsData;
}) {
  const [selected, setSelected] = useState<(typeof milestones)[number] | null>(
    null,
  );
  return (
    <>
      <div className="achievement-grid">
        {milestones.map((milestone) => {
          const { title, description, key, goal, art } = milestone;
          const earned = rewards.earned.some((e) => e.code === art);
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
                value={earned ? 100 : Math.min(100, (person[key] / goal) * 100)}
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
        classNames={gameDialogClasses}
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
              {Math.max(
                person[selected.key],
                rewards.earned.some((e) => e.code === selected.art)
                  ? selected.goal
                  : 0,
              )}{' '}
              из {selected.goal} ·{' '}
              {rewards.earned.some((e) => e.code === selected.art)
                ? 'Достигнуто'
                : 'В процессе'}
            </strong>
            <p>
              Достижение остаётся в коллекции после получения. Прогресс до
              получения показан по выбранным доскам; сам значок не добавляет
              баллов.
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
    <div className="profile-editor">
      <div className="profile-identity">
        <div className="profile-identity-heading">
          <span className="profile-eyebrow">Личный кабинет</span>
          <h2>{name(profile.user)}</h2>
          <span>
            {profile.user.role === 'superadmin'
              ? 'Суперадминистратор'
              : profile.user.role === 'admin'
                ? 'Администратор'
                : 'Пользователь'}
          </span>
        </div>
        <Group className="profile-photo" align="flex-start">
          <Avatar
            size={88}
            radius={28}
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
              PNG, JPEG или WebP · до 10 МБ
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
      </div>
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
        <div className="profile-section-heading">
          <h3>Личные данные</h3>
          <span>Так вас видят коллеги</span>
        </div>
        <div className="profile-name-fields">
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
        </div>
        <TextInput
          label="Email для входа"
          value={profile.user.email}
          readOnly
          description="Адрес и права учётной записи меняет администратор."
        />
        <Textarea
          label="О себе"
          minRows={3}
          autosize
          disabled={busy}
          placeholder="Чем вы помогаете команде"
          value={bio}
          maxLength={240}
          onChange={(e) => {
            setBio(e.target.value);
            onDirtyChange(true);
          }}
        />
        <div className="profile-save">
          <div aria-live="polite">
            {error && (
              <Text c="red" role="alert">
                {error}
              </Text>
            )}
            {message && <Text role="status">{message}</Text>}
          </div>
          <Button type="submit" loading={busy}>
            Сохранить профиль
          </Button>
        </div>
      </form>
    </div>
  );
}

export function TeamProgress({
  headerTarget,
  user,
  updateUser,
  request,
  profileOpen,
  closeProfile,
}: {
  headerTarget: HTMLElement | null;
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
  const [wardrobeOpen, setWardrobeOpen] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [scope, setScope] = useState<'visible' | 'global'>('visible');
  const progress = useQuery<ProgressData>({
    queryKey: ['progress', user.id, scope],
    queryFn: () => request(`/progress?scope=${scope}`),
    refetchInterval: 15000,
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
  const next =
    data &&
    milestones
      .filter((m) => !data.rewards.earned.some((e) => e.code === m.art))
      .sort(
        (a, b) =>
          data.me[b.key] / b.goal - data.me[a.key] / a.goal || a.goal - b.goal,
      )[0];
  const selectFrame = async (frame: string) => {
    await request('/profile/frame', {
      method: 'PUT',
      body: JSON.stringify({ frame }),
    });
    await Promise.all([
      profile.refetch(),
      queryClient.invalidateQueries({ queryKey: ['progress', user.id] }),
    ]);
  };
  const leaders = (limit: number) =>
    data && (
      <div className="leader-table">
        <div className="leader-table-heading" aria-hidden="true">
          <span>Место</span>
          <span>Участник</span>
          <span>Баллы</span>
        </div>
        <ol className="leader-list" aria-label="Рейтинг участников">
          {data.leaders.slice(0, limit).map((person) => (
            <li
              key={person.id}
              className={person.id === user.id ? 'is-me' : ''}
              data-podium={
                person.rank && person.rank <= 3 ? person.rank : undefined
              }
            >
              <span className="leader-position">
                <b>{person.rank ?? '—'}</b>
                <small>место</small>
              </span>
              <div className="leader-identity">
                <RewardAvatar
                  name={name(person)}
                  frame={person.frame}
                  winnerPlace={person.winnerPlace}
                  size={32}
                  src={
                    person.hasAvatar
                      ? `/api/profile/avatar/${person.id}`
                      : undefined
                  }
                />
                <div className="leader-name">
                  <strong title={name(person)}>{name(person)}</strong>
                  <small>
                    {person.id === user.id && <em>Вы</em>}
                    Завершено: {person.monthCompleted}
                  </small>
                </div>
              </div>
              <span className="leader-points">
                <b>{person.points.toLocaleString('ru-RU')}</b>
                <small>баллов</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  return (
    <>
      {headerTarget &&
        createPortal(
          <div className="header-rewards" aria-label="Ваши награды">
            <button
              type="button"
              className="header-achievements"
              aria-label={`Мои достижения${data ? `: ${data.rewards.earned.length}` : ''}`}
              onClick={() => setOpened(true)}
              title="Мои достижения"
            >
              <span className="header-earned-icons" aria-hidden="true">
                {data?.rewards.earned.length ? (
                  [...data.rewards.earned]
                    .sort((a, b) => b.earnedAt.localeCompare(a.earnedAt))
                    .filter((earned) =>
                      milestones.some((m) => m.art === earned.code),
                    )
                    .slice(0, 3)
                    .map((earned) => (
                      <img
                        key={earned.code}
                        src={`/achievements/${earned.code}.png`}
                        alt=""
                        width={32}
                        height={32}
                      />
                    ))
                ) : (
                  <span className="header-reward-empty">Достижения</span>
                )}
              </span>
              {data && (
                <span className="header-reward-count">
                  {data.rewards.earned.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="header-frame-button"
              aria-label="Выбрать рамку аватара"
              title="Рамки аватара"
              onClick={() => setWardrobeOpen(true)}
            >
              <span
                className={`reward-avatar frame-${data?.rewards.selectedFrame ?? 'none'} header-frame-sample`}
                aria-hidden="true"
              >
                <span />
              </span>
              <span className="header-frame-label">Рамки</span>
            </button>
          </div>,
          headerTarget,
        )}
      <PointCelebration events={data?.recentEvents} userId={user.id} />
      <aside className="team-rail" aria-label="Команда и достижения">
        <div className="team-rail-heading">
          <span className="season-kicker">Команда и достижения</span>
          <h2>{period}</h2>
        </div>
        {scopeControl}
        {loadState}
        {data && (
          <>
            <section className="team-score" aria-label="Ваш результат">
              <span>Ваш результат</span>
              <div className="team-score-number">
                <strong>{data.me.points.toLocaleString('ru-RU')}</strong>
                <span>баллов</span>
              </div>
              <div className="team-score-breakdown">
                <span>
                  <span>Создано</span>
                  <b>{data.me.monthCreated.toLocaleString('ru-RU')}</b>
                </span>
                <span>
                  <span>Завершено</span>
                  <b>{data.me.monthCompleted.toLocaleString('ru-RU')}</b>
                </span>
              </div>
              <p>
                {data.me.rank
                  ? `Место ${data.me.rank} из ${data.participants}`
                  : 'Место в рейтинге: —'}
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
                <small>
                  {next ? 'Следующее достижение' : 'Коллекция собрана'}
                </small>
                <strong>{next ? next.title : 'Все восемь достижений'}</strong>
                <span>
                  {next ? next.description : 'Посмотреть свои результаты'}
                </span>
                {next && (
                  <span className="next-achievement-progress">
                    <progress
                      value={Math.min(data.me[next.key], next.goal)}
                      max={next.goal}
                      aria-label={`Прогресс: ${next.title}`}
                    />
                    <small>
                      {data.me[next.key]} / {next.goal}
                    </small>
                  </span>
                )}
              </span>
              <ChevronRight size={16} />
            </button>
            <section className="team-leaders">
              <div className="team-section-title">
                <h3>Лидеры месяца</h3>
                <span>{data.participants} участников</span>
              </div>
              {!data.leaders.length && (
                <p className="team-empty">Пока нет результатов</p>
              )}
              {leaders(3)}
            </section>
          </>
        )}
        <Button
          className="team-open"
          variant="default"
          rightSection={<ChevronRight size={16} />}
          onClick={() => setOpened(true)}
        >
          Рейтинг и достижения
        </Button>
        <Button
          className="reward-open"
          variant="subtle"
          onClick={() => setWardrobeOpen(true)}
        >
          Рамки и награды
        </Button>
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
        closeOnEscape={!wardrobeOpen}
        onClose={() => setOpened(false)}
        size={760}
        centered
        title="Команда и достижения"
        classNames={gameDialogClasses}
      >
        {scopeControl}
        {loadState}
        {data && (
          <>
            <div className="team-personal-strip">
              <strong>
                Ваш результат: {data.me.points.toLocaleString('ru-RU')} баллов
              </strong>
              <span>
                {data.me.rank ? `Место ${data.me.rank}` : 'Пока без места'} ·{' '}
                {period}
              </span>
            </div>
            <section className="team-collection">
              <div className="reward-section-heading">
                <h2>Ваша коллекция</h2>
                <span>
                  {data.rewards.earned.length} / {milestones.length}
                </span>
              </div>
              <Achievements person={data.me} rewards={data.rewards} />
              <Button
                variant="light"
                mt="md"
                onClick={() => setWardrobeOpen(true)}
              >
                Рамки и награды
              </Button>
            </section>
            <section className="team-leaders">
              <div className="team-section-title">
                <h2>Рейтинг месяца</h2>
                <span>{data.participants} участников</span>
              </div>
              {!progress.data.leaders.length && (
                <Text>Пока нет результатов</Text>
              )}
              {leaders(20)}
              {data.participants > 20 && (
                <p>Показано 20 из {data.participants}</p>
              )}
            </section>
            <details className="progress-rules">
              <summary>Как начисляются баллы</summary>
              <p>
                При одинаковом количестве баллов участники занимают одно место.
                Общий рейтинг не раскрывает содержание закрытых досок.
              </p>
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
                время учёта. Полученные значки остаются в коллекции, даже если
                задача возвращена в работу.
              </p>
            </details>
          </>
        )}
      </Modal>
      <Modal
        opened={wardrobeOpen}
        onClose={() => setWardrobeOpen(false)}
        title="Рамки и награды"
        size={760}
        centered
        classNames={gameDialogClasses}
      >
        {data && (
          <RewardWardrobe
            rewards={data.rewards}
            name={name(user)}
            avatar={
              data.me.hasAvatar ? `/api/profile/avatar/${user.id}` : undefined
            }
            onSelect={selectFrame}
          />
        )}
        {loadState}
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
        className="profile-modal"
        centered
        size={820}
      >
        {profile.isError ? (
          <Stack>
            <Text role="alert">Не удалось загрузить профиль</Text>
            <Button onClick={() => void profile.refetch()}>Повторить</Button>
          </Stack>
        ) : profile.data ? (
          <Tabs defaultValue="personal" keepMounted>
            <Tabs.List className="profile-tabs">
              <Tabs.Tab value="personal">Личные данные</Tabs.Tab>
              <Tabs.Tab value="achievements">Достижения</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="personal">
              <ProfileForm
                profile={profile.data}
                request={request}
                updateUser={updateUser}
                refresh={refresh}
                onDirtyChange={setProfileDirty}
                onBusyChange={setProfileBusy}
              />
            </Tabs.Panel>
            <Tabs.Panel value="achievements" pt="lg">
              {progress.data && (
                <section>
                  <Group justify="space-between">
                    <h2>Мои достижения</h2>
                    <Badge>{progress.data.me.points} баллов за месяц</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mb="sm">
                    {progress.data.scope}
                  </Text>
                  <Achievements
                    person={progress.data.me}
                    rewards={progress.data.rewards}
                  />
                  <RewardWardrobe
                    rewards={progress.data.rewards}
                    name={name(user)}
                    avatar={
                      profile.data.hasAvatar
                        ? `/api/profile/avatar/${user.id}`
                        : undefined
                    }
                    onSelect={selectFrame}
                  />
                </section>
              )}
            </Tabs.Panel>
          </Tabs>
        ) : (
          <Text>Загружаем профиль…</Text>
        )}
      </Modal>
    </>
  );
}
