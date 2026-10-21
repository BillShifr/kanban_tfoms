import { test, expect } from '@playwright/test';

test('keeps the reward dialog rounded while its body scrolls', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(process.env.E2E_EMAIL ?? 'admin@example.com');
  await page
    .getByLabel('Пароль')
    .fill(process.env.E2E_PASSWORD ?? 'change-me-now');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('.user-menu-trigger')).toBeVisible();

  await page.locator(isMobile ? '.team-mobile-bar' : '.team-open').click();
  const dialog = page.getByRole('dialog', { name: 'Команда и достижения' });
  await expect(dialog).toBeVisible();

  const scrollLayout = await dialog.evaluate((element) => {
    const body = element.querySelector('.mantine-Modal-body');
    if (!(body instanceof HTMLElement)) throw new Error('Modal body missing');
    const dialogStyle = getComputedStyle(element);
    const bodyStyle = getComputedStyle(body);
    return {
      dialogOverflow: dialogStyle.overflow,
      topRightRadius: dialogStyle.borderTopRightRadius,
      bottomRightRadius: dialogStyle.borderBottomRightRadius,
      bodyOverflowY: bodyStyle.overflowY,
      bodyMinHeight: bodyStyle.minHeight,
    };
  });

  expect(scrollLayout).toEqual({
    dialogOverflow: 'hidden',
    topRightRadius: '18px',
    bottomRightRadius: '18px',
    bodyOverflowY: 'auto',
    bodyMinHeight: '0px',
  });
});
