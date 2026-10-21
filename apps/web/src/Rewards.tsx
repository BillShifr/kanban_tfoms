import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Text } from '@mantine/core';
import { LockKeyhole, Sparkles, Trophy } from 'lucide-react';
import { RewardAvatar } from './RewardAvatar';

export type RewardsData = {
  earned: { code: string; earnedAt: string }[];
  frames: string[];
  selectedFrame: string;
  seasons: {
    period: string;
    place: number;
    points: number;
    completed: number;
  }[];
};
export type PointEvent = {
  id: string;
  kind: string;
  points: number;
  createdAt: string;
};
const frames = [
  { id: 'none', name: 'Без рамки', condition: 'Стандартный аватар' },
  { id: 'trail', name: 'Искра', condition: 'Завершить 1 задачу' },
  { id: 'bridge', name: 'Связь', condition: 'Завершить 10 задач' },
  { id: 'summit', name: 'Горизонт', condition: 'Завершить 50 задач' },
  { id: 'nova', name: 'Сверхновая', condition: '1 место по итогам месяца' },
  { id: 'prism', name: 'Призма', condition: '2 место по итогам месяца' },
  { id: 'tide', name: 'Прилив', condition: '3 место по итогам месяца' },
];

export function RewardWardrobe({
  rewards,
  name,
  avatar,
  onSelect,
}: {
  rewards: RewardsData;
  name: string;
  avatar?: string;
  onSelect: (frame: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="reward-wardrobe">
      <div className="reward-section-heading">
        <h2>Рамки аватара</h2>
        <span>{rewards.frames.length - 1} / 6</span>
      </div>
      <div className="frame-collection">
        {frames.map((frame) => {
          const unlocked = rewards.frames.includes(frame.id);
          const selected = rewards.selectedFrame === frame.id;
          return (
            <button
              key={frame.id}
              type="button"
              disabled={!unlocked || busy}
              aria-pressed={selected}
              className={`frame-option ${selected ? 'is-selected' : ''}`}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onSelect(frame.id);
                } catch {
                  setError('Не удалось сохранить рамку. Попробуйте ещё раз.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RewardAvatar
                name={name}
                src={avatar}
                frame={frame.id}
                size={42}
                preview
                winnerPlace={
                  ['nova', 'prism', 'tide'].indexOf(frame.id) + 1 || undefined
                }
              />
              <strong>{frame.name}</strong>
              <small>{frame.condition}</small>
              <span>
                {!unlocked ? (
                  <>
                    <LockKeyhole size={12} /> Закрыто
                  </>
                ) : selected ? (
                  'Надета'
                ) : (
                  'Надеть'
                )}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <Text role="alert" c="red">
          {error}
        </Text>
      )}
      <div className="reward-section-heading">
        <h2>Награды за месяц</h2>
        <Trophy size={20} />
      </div>
      {rewards.seasons.length ? (
        <ol className="season-awards">
          {rewards.seasons.map((season) => (
            <li key={season.period}>
              <span className={`season-medal place-${season.place}`}>
                <Trophy size={22} />
                <b>{season.place}</b>
              </span>
              <div>
                <strong>
                  {new Intl.DateTimeFormat('ru-RU', {
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(`${season.period}-01T00:00:00Z`))}
                </strong>
                <span>
                  {season.completed} завершено ·{' '}
                  {season.points.toLocaleString('ru-RU')} баллов
                </span>
              </div>
              <span>{season.place} место</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rewards-empty">
          Первый сезон ещё не завершён или призовых мест пока нет.
        </p>
      )}
      <details className="progress-rules">
        <summary>Правила сезонных наград</summary>
        <p>
          В начале месяца баллы рейтинга начинаются с нуля. Достижения,
          полученные рамки и история призовых мест сохраняются. Рамку можно
          менять в любой момент.
        </p>
        <p>
          Месячные награды выдаются по общему рейтингу среди сотрудников,
          завершивших хотя бы одну задачу. При равенстве баллов место
          одинаковое. «Доступные доски» — локальный рейтинг, он не выдаёт
          отдельные сезонные награды.
        </p>
        <p>
          Первые три места открывают рамки. Аура призёра действует весь
          следующий месяц, даже если надета другая рамка. Закрытый сезон не
          пересчитывается. Учёт сезонов начинается с установки этого обновления;
          прошлые награды задним числом не выдаются.
        </p>
      </details>
    </section>
  );
}

export function PointCelebration({
  events,
  userId,
}: {
  events?: PointEvent[];
  userId: string;
}) {
  const seen = useRef<{ user: string; ids: Set<string> } | null>(null);
  const [notice, setNotice] = useState<{
    key: string;
    ids: string[];
    points: number;
    completed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!events) return;
    if (!seen.current || seen.current.user !== userId) {
      seen.current = { user: userId, ids: new Set(events.map((e) => e.id)) };
      return;
    }
    const fresh = events.filter((e) => !seen.current!.ids.has(e.id));
    // Deletion/reopening can revoke an event while its animation is visible.
    // Do not announce points which are no longer present on the server.
    setNotice((current) =>
      current && current.ids.some((id) => !events.some((e) => e.id === id))
        ? null
        : current,
    );
    for (const e of events) seen.current.ids.add(e.id);
    const recent = fresh.filter(
      (e) => Date.now() - Date.parse(e.createdAt) < 300000,
    );
    if (recent.length)
      setNotice({
        key: recent.map((e) => e.id).join(','),
        ids: recent.map((e) => e.id),
        points: recent.reduce((sum, e) => sum + e.points, 0),
        completed: recent.some((e) => e.kind === 'completed'),
      });
  }, [events, userId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return notice
    ? createPortal(
        <div className="points-stage" key={notice.key}>
          <div
            key={notice.key}
            className="points-celebration"
            role="status"
            aria-live="polite"
          >
            <Sparkles size={24} aria-hidden="true" />
            <div>
              <strong>
                +{notice.points}{' '}
                <span>
                  {new Intl.PluralRules('ru').select(notice.points) === 'one'
                    ? 'балл'
                    : new Intl.PluralRules('ru').select(notice.points) === 'few'
                      ? 'балла'
                      : 'баллов'}
                </span>
              </strong>
              <span>
                {notice.completed ? 'Задача завершена' : 'Задача создана'}
              </span>
            </div>
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              aria-label="Закрыть уведомление о баллах"
              onClick={() => setNotice(null)}
            >
              ×
            </Button>
          </div>
        </div>,
        document.body,
      )
    : null;
}
