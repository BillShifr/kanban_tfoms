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
    await expect(page.locator('.user-menu-trigger')).toBeVisible();

    const visible = await (
      await page.request.get('/api/progress?scope=visible')
    ).json();
    expect(visible.participants).toBe(0);
    const globalResponse = await page.request.get('/api/progress?scope=global');
    expect(globalResponse.status()).toBe(200);
    const global = await globalResponse.json();
    expect(global.participants).toBeGreaterThan(0);
    const places = new Map<number, number>();
    for (const person of global.leaders) {
      expect(person.points).toBe(
        person.monthCreated * 2 + person.monthCompleted * 10,
      );
      if (person.points === 0) expect(person.rank).toBeNull();
      else if (places.has(person.points))
        expect(person.rank).toBe(places.get(person.points));
      else places.set(person.points, person.rank);
    }
    expect(JSON.stringify(global)).not.toContain(board.id);
    expect(JSON.stringify(global)).not.toContain(`Secret task ${suffix}`);
    expect((await page.request.get(`/api/boards/${board.id}`)).status()).toBe(
      404,
    );
    expect(
      (await page.request.get('/api/progress?scope=invalid')).status(),
    ).toBe(400);

    await page.locator(isMobile ? '.team-mobile-bar' : '.team-open').click();
    const drawer = page.getByRole('dialog', { name: 'Команда и достижения' });
    await drawer.getByText('Все сотрудники', { exact: true }).first().click();
    await expect(drawer.locator('.leader-list li').first()).toBeVisible();
    await expect(drawer.getByText('Баллы', { exact: true })).toBeVisible();
    const numericStyles = await drawer
      .locator('.leader-position b')
      .first()
      .evaluate((el) => ({
        size: getComputedStyle(el).fontSize,
        variant: getComputedStyle(el).fontVariantNumeric,
      }));
    expect(numericStyles).toEqual({ size: '18px', variant: 'tabular-nums' });
    await expect(drawer.locator('.leader-position small').first()).toHaveText(
      'место',
    );
    await expect(drawer.locator('.leader-points small').first()).toHaveText(
      'баллов',
    );
    await expect(drawer.locator('.achievement')).toHaveCount(8);
    await drawer.getByText('Доступные доски', { exact: true }).click();
    await expect(drawer.getByText('Пока нет результатов')).toBeVisible();
    await drawer.getByRole('button', { name: /Первый шаг/ }).click();
    const condition = page.getByRole('dialog', { name: 'Условие достижения' });
    await expect(condition.getByText('0 из 1 · В процессе')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');

    await page.locator('.user-menu-trigger').click();
    await page.getByRole('menuitem', { name: 'Мой профиль' }).click();
    const profile = page.getByRole('dialog', { name: /профиль/i });
    const aura = profile.locator('.frame-nova.winner-aura');
    expect(
      await aura.evaluate(
        (el) => getComputedStyle(el, '::after').animationName,
      ),
    ).toBe('winner-breathe');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await aura.evaluate(
        (el) => getComputedStyle(el, '::after').animationName,
      ),
    ).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(
      (
        await page.request.put('/api/profile/frame', {
          data: { frame: 'nova' },
        })
      ).status(),
    ).toBe(403);
    await expect(profile.getByRole('button', { name: /Искра/ })).toBeDisabled();
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
    await profile.getByRole('button', { name: 'Сохранить профиль' }).click();
    await expect(page.locator('.points-celebration')).toContainText('+2');
    expect(
      await page
        .locator('.points-celebration')
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('points-arrive');
    await page
      .getByRole('button', { name: 'Закрыть уведомление о баллах' })
      .click();
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
    expect(scored.me).toMatchObject({
      points: 12,
      created: 1,
      completed: 1,
      monthCreated: 1,
      monthCompleted: 1,
      rank: 1,
    });
    expect(scored.rewards.frames).toContain('trail');
    expect(scored.rewards.frames).not.toContain('nova');
    expect(
      scored.rewards.earned.map((e: { code: string }) => e.code).sort(),
    ).toEqual(['initiative', 'result']);
    await profile.getByRole('button', { name: 'Сохранить профиль' }).click();
    await expect(page.locator('.points-celebration')).toContainText('+10');
    await page
      .getByRole('button', { name: 'Закрыть уведомление о баллах' })
      .click();
    await profile.getByRole('button', { name: /Искра/ }).click();
    await expect(
      profile.getByRole('button', { name: /Искра/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.user-menu-trigger .frame-trail')).toBeVisible();
    await expect(page.locator('.points-celebration')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.user-menu-trigger .frame-trail')).toBeVisible();
    await expect(page.locator('.points-celebration')).toHaveCount(0);
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
