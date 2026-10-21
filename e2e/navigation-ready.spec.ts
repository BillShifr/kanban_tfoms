import { expect, test } from '@playwright/test';

test('creation controls wait for the real navigation data', async ({
  page,
  isMobile,
}) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/departments', async (route) => {
    await ready;
    await route.continue();
  });
  await page.route('**/api/boards', async (route) => {
    await ready;
    await route.continue();
  });
  try {
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill(process.env.E2E_EMAIL ?? 'admin@example.com');
    await page
      .getByLabel('Пароль')
      .fill(process.env.E2E_PASSWORD ?? 'change-me-now');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByTestId('workspace')).toBeVisible();
    if (isMobile) await page.getByTestId('mobile-sidebar-trigger').click();
    const navigation = page.getByTestId(
      isMobile ? 'mobile-sidebar' : 'desktop-sidebar',
    );
    await expect(
      navigation.getByRole('button', { name: 'Создать отдел', exact: true }),
    ).toHaveCount(0);
    await expect(
      navigation.getByRole('button', { name: 'Создать доску', exact: true }),
    ).toHaveCount(0);
    release();
    if (isMobile) {
      await expect(page.locator('#board-title')).toBeVisible();
      await expect(
        navigation.getByRole('dialog', { name: 'Доски', exact: true }),
      ).toBeVisible();
    }
    await navigation
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .click();
    await expect(page.getByLabel('Название нового отдела')).toBeVisible();
  } finally {
    release();
  }
});
