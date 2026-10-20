import { test, expect } from '@playwright/test';

test('profile and both leaderboard scopes preserve board privacy', async ({
  page,
  request,
  isMobile,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = 'Progress-test-2026!';
  const email = `progress-${suffix}@example.test`;
  expect(
    (
      await request.post('/api/auth/sign-in', {
        data: {
          email: process.env.E2E_EMAIL ?? 'admin@example.com',
          password: process.env.E2E_PASSWORD ?? 'change-me-now',
        },
      })
    ).status(),
  ).toBe(200);
  const accountResponse = await request.post('/api/admin/users', {
    data: { email, password, role: 'user' },
  });
  expect(accountResponse.status()).toBe(201);
  const { user } = await accountResponse.json();
  const deptResponse = await request.post('/api/departments', {
    data: { name: `Private progress ${suffix}` },
  });
  expect(deptResponse.status()).toBe(201);
  const { department } = await deptResponse.json();
  const boardResponse = await request.post('/api/boards', {
    data: { name: `Hidden board ${suffix}`, departmentId: department.id },
  });
  expect(boardResponse.status()).toBe(201);
  const { board } = await boardResponse.json();
  let taskId: string | undefined;
  let ownTaskId: string | undefined;
  try {
    const detail = await (await request.get(`/api/boards/${board.id}`)).json();
    const taskResponse = await request.post(`/api/boards/${board.id}/tasks`, {
      data: { title: `Secret task ${suffix}`, columnId: detail.columns[0].id },
    });
    expect(taskResponse.status()).toBe(201);
    taskId = (await taskResponse.json()).task.id;

    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByLabel('Пароль').fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Мой профиль' }),
    ).toBeVisible();

    const visible = await (
      await page.request.get('/api/progress?scope=visible')
    ).json();
    expect(visible.participants).toBe(0);
    const globalResponse = await page.request.get('/api/progress?scope=global');
    expect(globalResponse.status()).toBe(200);
    const global = await globalResponse.json();
    expect(global.participants).toBeGreaterThan(0);
    expect(JSON.stringify(global)).not.toContain(board.id);
    expect(JSON.stringify(global)).not.toContain(`Secret task ${suffix}`);
    expect((await page.request.get(`/api/boards/${board.id}`)).status()).toBe(
      404,
    );
    expect(
      (await page.request.get('/api/progress?scope=invalid')).status(),
    ).toBe(400);

    await page.getByRole('button', { name: /Пульс команды/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Пульс команды' });
    await drawer.getByText('Все сотрудники', { exact: true }).first().click();
    await expect(
      drawer.getByText(
        'Общий вклад сотрудников без раскрытия задач и закрытых досок.',
      ),
    ).toBeVisible();
    await drawer.getByText('Доступные доски', { exact: true }).click();
    await expect(
      drawer.getByText(/Первый результат ещё впереди/),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Мой профиль' }).click();
    const profile = page.getByRole('dialog', { name: /профиль/i });
    await profile.getByLabel('Фамилия', { exact: true }).fill('Тестов');
    await profile.getByLabel('Имя', { exact: true }).fill('Иван');
    await profile.getByLabel('О себе').fill('Помогаю команде');
    await profile.getByRole('button', { name: 'Сохранить профиль' }).click();
    await expect(profile.getByRole('status')).toHaveText('Изменения сохранены');
    const saved = await (await page.request.get('/api/profile')).json();
    expect(saved.user).toMatchObject({
      id: user.id,
      firstName: 'Иван',
      lastName: 'Тестов',
      role: 'user',
    });
    expect(saved.bio).toBe('Помогаю команде');
    await profile.locator('input[type="file"]').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: await page.screenshot(),
    });
    await expect(
      profile.getByRole('button', { name: 'Удалить фото' }),
    ).toBeVisible();
    const avatarResponse = await page.request.get(
      `/api/profile/avatar/${user.id}`,
    );
    expect(avatarResponse.status()).toBe(200);
    expect(avatarResponse.headers()['content-type']).toContain('image/jpeg');
    await profile.getByRole('button', { name: 'Удалить фото' }).click();
    await expect(
      profile.getByRole('button', { name: 'Удалить фото' }),
    ).toBeHidden();
    expect(
      (await page.request.get(`/api/profile/avatar/${user.id}`)).status(),
    ).toBe(404);
    expect(
      (
        await page.request.patch('/api/profile', {
          data: {
            firstName: 'Иван',
            lastName: 'Тестов',
            bio: '',
            role: 'superadmin',
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post('/api/profile/avatar', {
          multipart: {
            avatar: {
              name: 'evil.svg',
              mimeType: 'image/svg+xml',
              buffer: Buffer.from('<svg/>'),
            },
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post(`/api/boards/${board.id}/members`, {
          data: { userId: user.id },
        })
      ).status(),
    ).toBe(201);
    const own = await page.request.post(`/api/boards/${board.id}/tasks`, {
      data: {
        title: `My contribution ${suffix}`,
        columnId: detail.columns[0].id,
        assigneeId: user.id,
      },
    });
    expect(own.status()).toBe(201);
    ownTaskId = (await own.json()).task.id;
    for (const column of [
      detail.columns.at(-1),
      detail.columns[0],
      detail.columns.at(-1),
    ]) {
      expect(
        (
          await page.request.post(
            `/api/boards/${board.id}/tasks/${ownTaskId}/move`,
            {
              data: { columnId: column.id },
            },
          )
        ).status(),
      ).toBe(200);
    }
    const scored = await (
      await page.request.get('/api/progress?scope=visible')
    ).json();
    expect(scored.me).toMatchObject({ points: 12, created: 1, completed: 1 });
    await page.reload();
    const title = `My contribution ${suffix}`;
    await page
      .getByRole('button', { name: `Свернуть задачу «${title}»`, exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: `Развернуть задачу «${title}»`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: `Развернуть задачу «${title}»`,
        exact: true,
      }),
    ).toBeVisible();
    const lastColumn = detail.columns.at(-1).name;
    await page
      .getByRole('button', {
        name: `Свернуть колонку ${lastColumn}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('button', {
        name: `Развернуть колонку ${lastColumn}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: `Развернуть задачу «${title}»`,
        exact: true,
      }),
    ).toBeHidden();
    if (!isMobile) {
      const handle = page.getByRole('button', {
        name: `Переместить «Secret task ${suffix}»`,
        exact: true,
      });
      const target = page
        .getByRole('button', {
          name: `Развернуть колонку ${lastColumn}`,
          exact: true,
        })
        .locator('xpath=ancestor::article');
      const sourceBox = await handle.boundingBox();
      const targetBox = await target.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(targetBox).not.toBeNull();
      await page.mouse.move(sourceBox!.x + 8, sourceBox!.y + 8);
      await page.mouse.down();
      await page.mouse.move(targetBox!.x + 30, targetBox!.y + 90, {
        steps: 15,
      });
      await page.mouse.up();
      await expect
        .poll(async () => {
          const updated = await (
            await page.request.get(`/api/boards/${board.id}`)
          ).json();
          return updated.columns
            .at(-1)
            .tasks.some((task: { id: string }) => task.id === taskId);
        })
        .toBe(true);
    }
  } finally {
    if (ownTaskId)
      await request.delete(`/api/boards/${board.id}/tasks/${ownTaskId}`);
    if (taskId) await request.delete(`/api/boards/${board.id}/tasks/${taskId}`);
    await request.post(`/api/boards/${board.id}/archive`);
    await request.delete(`/api/boards/${board.id}`);
    await request.delete(`/api/departments/${department.id}`);
    await request.delete(`/api/admin/users/${user.id}`);
  }
});
