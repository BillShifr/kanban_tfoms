import type { Pool } from 'pg';

export const frameRequirements: Record<
  string,
  { achievement?: string; place?: number }
> = {
  none: {},
  trail: { achievement: 'result' },
  bridge: { achievement: 'bridge' },
  summit: { achievement: 'summit' },
  nova: { place: 1 },
  prism: { place: 2 },
  tide: { place: 3 },
};

export async function rewardsFor(pool: Pool, userId: string) {
  await pool.query('select finalize_reward_seasons()');
  await pool.query('select grant_achievements($1)', [userId]);
  const earned = await pool.query<{ code: string; earnedAt: string }>(
    'select code,earned_at as "earnedAt" from earned_achievements where user_id=$1 order by earned_at,code',
    [userId],
  );
  const seasons = await pool.query(
    `select to_char(period,'YYYY-MM') as period,place,points,completed
     from monthly_rewards where user_id=$1 order by period desc`,
    [userId],
  );
  const profile = await pool.query(
    'select selected_frame from user_profiles where user_id=$1',
    [userId],
  );
  return {
    earned: earned.rows,
    seasons: seasons.rows,
    selectedFrame: profile.rows[0]?.selected_frame ?? 'none',
    frames: Object.entries(frameRequirements)
      .filter(
        ([, rule]) =>
          (!rule.achievement ||
            earned.rows.some((e) => e.code === rule.achievement)) &&
          (!rule.place || seasons.rows.some((s) => s.place === rule.place)),
      )
      .map(([key]) => key),
  };
}
