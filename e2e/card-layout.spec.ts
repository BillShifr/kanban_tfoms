import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('dense columns keep every card around its content without overlap', async ({
  page,
}) => {
  const css = readFileSync('apps/web/src/styles.css', 'utf8');
  await page.setContent(`<style>${css}</style>
    <div class="column" style="height:400px">
      <header><h2>Готово</h2></header>
      <button class="quick-trigger">Добавить задачу</button>
      ${Array.from(
        { length: 12 },
        (_, i) => `
        <article class="card"><button class="card-open">
          <b>${i % 2 ? 'Короткое название' : 'Длинное название обращения с подробным описанием возникшей проблемы'}</b>
          <span class="card-description">${'ОписаниеОбращенияБезПробелов'.repeat(8)}</span>
          <footer>Коваль Лилия</footer>
        </button></article>`,
      ).join('')}
    </div>`);
  const measurements = await page.locator('.card').evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect();
      const content = card.querySelector('.card-open')!.getBoundingClientRect();
      const next = card.nextElementSibling?.getBoundingClientRect();
      return {
        contains: box.bottom >= content.bottom,
        separated: !next || next.top >= box.bottom + 7,
        fits: card.scrollWidth <= card.clientWidth,
      };
    }),
  );
  for (const measurement of measurements) {
    expect(measurement).toEqual({
      contains: true,
      separated: true,
      fits: true,
    });
  }
  expect(
    await page
      .locator('.column')
      .evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await page.locator('.card').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.card').last()).toBeInViewport();
});
