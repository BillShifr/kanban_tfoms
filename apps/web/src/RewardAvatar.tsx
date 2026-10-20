import { Avatar } from '@mantine/core';

export function RewardAvatar({
  name,
  src,
  frame = 'none',
  winnerPlace,
  preview = false,
  size = 36,
}: {
  name: string;
  src?: string;
  frame?: string;
  winnerPlace?: number | null;
  preview?: boolean;
  size?: number;
}) {
  return (
    <span
      className={`reward-avatar frame-${frame} ${winnerPlace ? 'winner-aura' : ''}`}
      data-winner={winnerPlace || undefined}
      title={
        preview
          ? 'Предпросмотр оформления'
          : winnerPlace
            ? `Призёр прошлого месяца · ${winnerPlace} место`
            : undefined
      }
    >
      <Avatar size={size} radius="xl" src={src}>
        {name.slice(0, 1)}
      </Avatar>
      {['nova', 'prism', 'tide'].includes(frame) && (
        <span className="frame-ornament" aria-hidden="true" />
      )}
    </span>
  );
}
