import { expect, test, type Locator, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_PASSWORD ?? 'change-me-now';

type Department = { id: string; name: string };

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
}

async function signInAs(page: Page, login: string, secret: string) {
  await page.goto('/');
  await expect(
    page.getByRole('img', { name: 'Логотип ТФОМС Югры' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill(login);
  await page.getByLabel('Пароль').fill(secret);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('main > header')).toBeVisible();
  await expect(
    page.getByLabel('ТФОМС Югры — Канбан', { exact: true }),
  ).toBeVisible();
}

async function signIn(page: Page) {
  await signInAs(page, email, password);
}

async function getDepartments(page: Page) {
  const response = await page.request.get('/api/departments');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { departments: Department[] };
  expect(body.departments.length).toBeGreaterThan(0);
  return body.departments;
}

async function openNavigation(page: Page) {
  await expect(page.getByTestId('workspace')).toBeVisible();
  const mobileTrigger = page.getByRole('button', {
    name: 'Открыть меню досок',
  });
  if (await mobileTrigger.isVisible()) {
    await mobileTrigger.click();
    const drawer = page
      .getByTestId('mobile-sidebar')
      .getByRole('dialog', { name: 'Доски', exact: true });
    await expect(drawer).toBeVisible();
    return drawer;
  }
  const sidebar = page.getByTestId('desktop-sidebar');
  await expect(sidebar).toBeVisible();
  return sidebar;
}

async function selectBoard(page: Page, name: string) {
  const navigation = await openNavigation(page);
  await navigation.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function createBoardForTest(page: Page) {
  const name = uniqueName('E2E');
  const [department] = await getDepartments(page);
  const response = await page.request.post('/api/boards', {
    data: { name, departmentId: department!.id },
  });
  expect(response.status()).toBe(201);
  await page.reload();
  await selectBoard(page, name);
  return name;
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole('textbox', { name: label, exact: true }).click();
  const item = page.getByRole('option', { name: option, exact: true });
  await expect(item).toBeVisible();
  await item.click();
}

function backlogColumn(page: Page) {
  return columnByName(page, 'Бэклог');
}

function columnByName(page: Page, name: string) {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

function taskCard(page: Page, title: string) {
  return page
    .getByTestId('task-card')
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function chooseAssignee(page: Page, option: string) {
  const input = page.getByRole('textbox', {
    name: 'Исполнитель',
    exact: true,
  });
  await input.fill(option);
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function chooseTextAssignee(page: Page, name: string) {
  const input = page.getByRole('textbox', {
    name: 'Исполнитель',
    exact: true,
  });
  await input.fill(name);
  await page
    .getByRole('option', { name: `Использовать «${name}»`, exact: true })
    .click();
}

async function addTask(page: Page, title: string) {
  const backlog = backlogColumn(page);
  await backlog.getByRole('button', { name: 'Добавить задачу' }).click();
  await backlog.getByPlaceholder('Новая задача').fill(title);
  await backlog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(backlog.getByText(title, { exact: true })).toBeVisible();
}

async function expectReadableText(
  locator: Locator,
  pseudoElement: string | null = null,
) {
  await expect(locator).toBeVisible();
  const contrast = await locator.evaluate((element, pseudo) => {
    const parse = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return {
        red: channels[0] ?? 0,
        green: channels[1] ?? 0,
        blue: channels[2] ?? 0,
        alpha: channels[3] ?? 1,
      };
    };
    const composite = (
      foreground: ReturnType<typeof parse>,
      background: ReturnType<typeof parse>,
    ) => ({
      red:
        foreground.red * foreground.alpha +
        background.red * (1 - foreground.alpha),
      green:
        foreground.green * foreground.alpha +
        background.green * (1 - foreground.alpha),
      blue:
        foreground.blue * foreground.alpha +
        background.blue * (1 - foreground.alpha),
      alpha: 1,
    });
    const layers: ReturnType<typeof parse>[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      layers.unshift(parse(getComputedStyle(node).backgroundColor));
    }
    const background = layers.reduce(
      (result, layer) => composite(layer, result),
      { red: 255, green: 255, blue: 255, alpha: 1 },
    );
    const foreground = composite(
      parse(getComputedStyle(element, pseudo).color),
      background,
    );
    const luminance = (color: ReturnType<typeof parse>) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * channel(color.red) +
        0.7152 * channel(color.green) +
        0.0722 * channel(color.blue)
      );
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  }, pseudoElement);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

test.describe('core board workflow', () => {
  test('signs in through the Russian interface', async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId('user-email')).toHaveText(email);
  });

  test('keeps primary light-theme controls and labels readable', async ({
    page,
  }) => {
    await signIn(page);
    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Светлое' }).click();
    await expect(page.locator('html')).toHaveAttribute(
      'data-mantine-color-scheme',
      'light',
    );

    const navigation = await openNavigation(page);
    await expectReadableText(navigation.locator('.aside-heading h2'));
    await expectReadableText(
      navigation.getByRole('button', { name: 'Создать доску', exact: true }),
    );
    await expectReadableText(
      navigation.getByRole('button', { name: 'Создать отдел', exact: true }),
    );
    if (
      await page.getByRole('button', { name: 'Открыть меню досок' }).isVisible()
    ) {
      await page.keyboard.press('Escape');
    }
    await expectReadableText(page.getByRole('button', { name: email }));
    await expectReadableText(page.locator('#board-title'));
    await expectReadableText(
      page.getByTestId('kanban-column').first().locator('header h2'),
    );
    await expectReadableText(
      page
        .getByTestId('kanban-column')
        .first()
        .locator('.column-header-actions > span'),
    );
    await expectReadableText(
      page.getByPlaceholder('Поиск по задачам'),
      '::placeholder',
    );
  });

  test('creates a department and a board in nested navigation', async ({
    page,
  }) => {
    await signIn(page);
    const departmentName = uniqueName('Отдел E2E');
    const boardName = uniqueName('Доска E2E');
    let navigation = await openNavigation(page);

    await navigation
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .click();
    const departmentForm = page.locator('form').filter({
      has: page.getByLabel('Название нового отдела'),
    });
    await departmentForm
      .getByLabel('Название нового отдела')
      .fill(departmentName);
    await departmentForm
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .click();

    await expect(
      navigation.getByRole('button', {
        name: `Свернуть отдел ${departmentName}`,
        exact: true,
      }),
    ).toBeVisible();
    await navigation
      .getByRole('button', { name: 'Создать доску', exact: true })
      .click();
    const boardForm = page.locator('form').filter({
      has: page.getByLabel('Название новой доски'),
    });
    await boardForm.getByLabel('Название новой доски').fill(boardName);
    await chooseOption(page, 'Отдел', departmentName);
    await boardForm
      .getByRole('button', { name: 'Создать доску', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: boardName, exact: true }),
    ).toBeVisible();
    navigation = await openNavigation(page);
    const department = navigation.getByTestId('department-section').filter({
      has: page.getByRole('button', {
        name: `Свернуть отдел ${departmentName}`,
        exact: true,
      }),
    });
    await expect(department).toBeVisible();
    await expect(
      department.getByRole('button', { name: boardName, exact: true }),
    ).toBeVisible();
  });

  test('deletes an empty department with confirmation', async ({ page }) => {
    await signIn(page);
    const departmentName = uniqueName('Пустой отдел');
    const navigation = await openNavigation(page);
    await navigation
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .click();
    await page.getByLabel('Название нового отдела').fill(departmentName);
    await page
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .last()
      .click();
    await navigation
      .getByRole('button', { name: `Действия отдела ${departmentName}` })
      .click();
    await page.getByRole('button', { name: 'Удалить отдел' }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(departmentName);
    await confirmation.getByRole('button', { name: 'Удалить' }).click();
    await expect(
      navigation.getByRole('button', {
        name: `Свернуть отдел ${departmentName}`,
      }),
    ).toHaveCount(0);
  });

  test('persists the collapsed desktop sidebar after reload', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop-only navigation');
    await signIn(page);
    const boardName = await createBoardForTest(page);
    const sidebar = page.getByTestId('desktop-sidebar');

    await sidebar
      .getByRole('button', { name: 'Свернуть боковую панель' })
      .click();
    await expect(
      sidebar.getByRole('button', { name: 'Развернуть боковую панель' }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('button', { name: boardName, exact: true }),
    ).toHaveCount(0);

    await page.reload();
    await expect(
      sidebar.getByRole('button', { name: 'Развернуть боковую панель' }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('button', { name: boardName, exact: true }),
    ).toHaveCount(0);
    await sidebar
      .getByRole('button', { name: 'Развернуть боковую панель' })
      .click();
    await expect(
      sidebar.getByRole('button', { name: boardName, exact: true }),
    ).toBeVisible();
  });

  test('opens the mobile drawer, selects a board, and closes it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile-only navigation');
    await signIn(page);
    const boardName = await createBoardForTest(page);

    const drawer = await openNavigation(page);
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: boardName, exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole('heading', { name: boardName, exact: true }),
    ).toBeVisible();
  });

  test('keeps responsive overflow inside the board', async ({ page }) => {
    await signIn(page);
    await createBoardForTest(page);
    const shell = page.getByTestId('workspace');
    const header = page.getByTestId('app-header');
    const board = page.getByTestId('board-scroll');
    const firstColumn = page.getByTestId('kanban-column').first();

    await expect(shell).toBeVisible();
    await expect(board).toBeVisible();
    await expect(firstColumn).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport);

    const headerBox = await header.boundingBox();
    const columnBox = await firstColumn.boundingBox();
    expect(headerBox?.height).toBeGreaterThanOrEqual(48);
    expect(headerBox?.height).toBeLessThanOrEqual(72);
    expect(columnBox?.width).toBeGreaterThanOrEqual(280);
    expect(columnBox?.width).toBeLessThanOrEqual(340);
  });

  test('creates a task inline in the backlog', async ({ page }) => {
    await signIn(page);
    await createBoardForTest(page);

    const title = `Проверить задачу ${Date.now()}`;
    await addTask(page, title);
    const card = taskCard(page, title);
    await expect(card.locator('footer')).toHaveCount(0);
    await expect(backlogColumn(page).getByLabel('Задач: 1')).toBeVisible();
  });

  test('creates and renames a column directly on the board', async ({
    page,
  }) => {
    await signIn(page);
    const boardName = await createBoardForTest(page);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const initialName = `Проверка ${suffix}`;
    const renamedName = `Приёмка ${suffix}`;

    await page.getByRole('button', { name: 'Добавить колонку' }).click();
    await page.getByLabel('Название новой колонки').fill(initialName);
    await page.getByRole('button', { name: 'Создать колонку' }).click();
    await expect(
      page.getByRole('heading', { name: initialName, exact: true }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: `Меню колонки ${initialName}` })
      .click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await page.getByLabel('Новое название колонки').fill(renamedName);
    await page
      .getByRole('button', { name: 'Сохранить название колонки' })
      .click();
    await expect(
      page.getByRole('heading', { name: renamedName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: initialName, exact: true }),
    ).toHaveCount(0);

    await page.reload();
    await selectBoard(page, boardName);
    await expect(
      page.getByRole('heading', { name: renamedName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: initialName, exact: true }),
    ).toHaveCount(0);

    await page
      .getByRole('button', { name: `Меню колонки ${renamedName}` })
      .click();
    await page.getByRole('menuitem', { name: 'Архивировать колонку' }).click();
    await page
      .getByRole('button', { name: 'Подтвердить архивирование' })
      .click();
    await expect(
      page.getByRole('heading', { name: renamedName, exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Настроить доску' }).click();
    await page.getByRole('tab', { name: 'Колонки' }).click();
    const archivedRow = page.locator('.archived-column-row').filter({
      has: page.getByText(renamedName, { exact: true }),
    });
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole('button', { name: 'Восстановить' }).click();
    await expect(archivedRow).toHaveCount(0);

    await page.reload();
    await selectBoard(page, boardName);
    await expect(
      page.getByRole('heading', { name: renamedName, exact: true }),
    ).toBeVisible();
  });

  test('archives and restores a board from the global archive', async ({
    page,
  }) => {
    await signIn(page);
    const boardName = await createBoardForTest(page);

    await page.getByRole('button', { name: 'Настроить доску' }).click();
    await page.getByRole('button', { name: 'Архивировать доску' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', {
        name: 'Архивировать',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('button', { name: boardName, exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Архив досок' }).click();
    const archived = page.locator('.archived-column-row').filter({
      has: page.getByText(boardName, { exact: true }),
    });
    await expect(archived).toBeVisible();
    await archived.getByRole('button', { name: 'Восстановить' }).click();
    await expect(page.getByRole('heading', { name: boardName })).toBeVisible();
    const navigation = await openNavigation(page);
    await expect(
      navigation.getByRole('button', { name: boardName, exact: true }),
    ).toBeVisible();
  });

  test('permanently deletes an empty archived board', async ({ page }) => {
    await signIn(page);
    const boardName = await createBoardForTest(page);
    await page.getByRole('button', { name: 'Настроить доску' }).click();
    await page.getByRole('button', { name: 'Архивировать доску' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Архивировать', exact: true })
      .click();
    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Архив досок' }).click();
    await page
      .getByRole('button', { name: `Удалить доску ${boardName} навсегда` })
      .click();
    const confirmation = page.getByRole('alertdialog');
    await confirmation.getByLabel(`Введите «${boardName}»`).fill(boardName);
    await confirmation
      .getByRole('button', { name: 'Удалить навсегда' })
      .click();
    await expect(page.getByText(boardName, { exact: true })).toHaveCount(0);
  });

  test('administrator manages users, roles, passwords, and account status', async ({
    page,
  }) => {
    await signIn(page);
    const userEmail = `crud-${Date.now()}@example.test`;
    const currentResponse = await page.request.get('/api/auth/me');
    const current = (await currentResponse.json()) as {
      user: { id: string };
    };
    const selfRoleChange = await page.request.patch(
      `/api/admin/users/${current.user.id}`,
      { data: { role: 'user' } },
    );
    expect(selfRoleChange.status()).toBe(409);
    expect(await selfRoleChange.json()).toEqual({ code: 'SELF_ROLE_CHANGE' });
    const selfArchive = await page.request.delete(
      `/api/admin/users/${current.user.id}`,
    );
    expect(selfArchive.status()).toBe(409);
    expect(await selfArchive.json()).toEqual({ code: 'SELF_ARCHIVE' });
    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Пользователи и права' }).click();
    await page.getByLabel('Email').fill(userEmail);
    await page.getByLabel('Пароль для входа').fill('initial-pass-123');
    await page.getByRole('button', { name: 'Создать пользователя' }).click();
    await expect(page.getByText(userEmail, { exact: true })).toBeVisible();

    await chooseOption(page, `Роль ${userEmail}`, 'Администратор');
    await expect(
      page.getByRole('textbox', { name: `Роль ${userEmail}` }),
    ).toHaveValue('Администратор');
    await chooseOption(page, `Роль ${userEmail}`, 'Пользователь');
    await expect(
      page.getByRole('textbox', { name: `Роль ${userEmail}` }),
    ).toHaveValue('Пользователь');

    await page
      .getByRole('button', { name: `Сменить пароль ${userEmail}` })
      .click();
    await page
      .getByLabel(`Новый пароль для ${userEmail}`)
      .fill('updated-pass-123');
    await page
      .getByRole('button', { name: 'Сменить пароль', exact: true })
      .click();
    await page.getByRole('button', { name: `Отключить ${userEmail}` }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Отключить' })
      .click();
    await page.getByRole('tab', { name: 'Отключённые' }).click();
    const archived = page.locator('.admin-user-row').filter({
      has: page.getByText(userEmail, { exact: true }),
    });
    await expect(archived).toBeVisible();
    await archived.getByRole('button', { name: 'Восстановить' }).click();
    await expect(archived).toHaveCount(0);
  });

  test('regular user has domain CRUD but no account administration', async ({
    page,
  }) => {
    await signIn(page);
    const userEmail = `worker-${Date.now()}@example.test`;
    const userPassword = 'worker-pass-123';
    const createdUserResponse = await page.request.post('/api/admin/users', {
      data: { email: userEmail, password: userPassword, role: 'user' },
    });
    expect(createdUserResponse.status()).toBe(201);
    const createdUser = (await createdUserResponse.json()) as {
      user: { id: string };
    };
    const [department] = await getDepartments(page);
    const boardName = uniqueName('Доска пользователя');
    const createdBoardResponse = await page.request.post('/api/boards', {
      data: { name: boardName, departmentId: department!.id },
    });
    expect(createdBoardResponse.status()).toBe(201);
    const createdBoard = (await createdBoardResponse.json()) as {
      board: { id: string };
    };
    const membership = await page.request.post(
      `/api/boards/${createdBoard.board.id}/members`,
      { data: { userId: createdUser.user.id, role: 'member' } },
    );
    expect(membership.status()).toBe(201);

    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await signInAs(page, userEmail, userPassword);
    await selectBoard(page, boardName);
    await expect(
      page.getByRole('button', { name: 'Настроить доску' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Добавить колонку' }),
    ).toBeVisible();
    await page.getByRole('button', { name: userEmail }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Пользователи и права' }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    const forbidden = await page.request.get('/api/admin/users');
    expect(forbidden.status()).toBe(403);

    const departmentName = uniqueName('Отдел пользователя');
    const navigation = await openNavigation(page);
    await navigation
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .click();
    await page.getByLabel('Название нового отдела').fill(departmentName);
    await page
      .getByRole('button', { name: 'Создать отдел', exact: true })
      .last()
      .click();
    await navigation
      .getByRole('button', { name: `Действия отдела ${departmentName}` })
      .click();
    await page.getByRole('button', { name: 'Удалить отдел' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Удалить' })
      .click();
    await expect(
      navigation.getByRole('button', {
        name: `Свернуть отдел ${departmentName}`,
      }),
    ).toHaveCount(0);
  });

  test('drags a task between columns and persists the move', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Touch drag is covered by the explicit move control on mobile',
    );

    await signIn(page);
    const boardName = await createBoardForTest(page);
    const title = `Задача для drag-and-drop ${Date.now()}`;
    await addTask(page, title);

    const backlog = backlogColumn(page);
    const inProgress = columnByName(page, 'В работе');
    const card = backlog.getByTestId('task-card').filter({
      has: page.getByText(title, { exact: true }),
    });

    const handle = card.getByRole('button', {
        name: `Переместить «${title}»`,
      }),
      cardBox = await card.boundingBox(),
      handleBox = await handle.boundingBox(),
      targetBox = await inProgress.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    const grabX = handleBox!.x + handleBox!.width / 2,
      grabY = handleBox!.y + handleBox!.height / 2,
      grabOffsetX = grabX - cardBox!.x,
      pointerX = targetBox!.x + targetBox!.width - 24,
      pointerY = targetBox!.y + 80;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 8, handleBox!.y + 8, { steps: 3 });
    await page.mouse.move(pointerX, pointerY, { steps: 12 });

    const preview = page.getByTestId('task-drag-preview');
    await expect(preview).toBeVisible();
    const samples = await preview.evaluate(async (node) => {
      const result: Array<{ left: number; right: number }> = [];
      for (let index = 0; index < 10; index += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const rect = node.getBoundingClientRect();
        result.push({ left: rect.left, right: rect.right });
      }
      return result;
    });
    const lefts = samples.map(({ left }) => left),
      expectedLeft = pointerX - grabOffsetX,
      placeholderBox = await card.boundingBox();
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1.5);
    for (const rect of samples) {
      expect(Math.abs(rect.left - expectedLeft)).toBeLessThanOrEqual(4);
      expect(rect.left).toBeGreaterThanOrEqual(targetBox!.x - 4);
      expect(rect.right).toBeLessThanOrEqual(
        targetBox!.x + targetBox!.width + 4,
      );
    }
    expect(Math.abs(placeholderBox!.x - cardBox!.x)).toBeLessThanOrEqual(1);
    await page.mouse.up();

    await expect(backlog.getByText(title, { exact: true })).toHaveCount(0);
    await expect(inProgress.getByText(title, { exact: true })).toBeVisible();

    await page.reload();
    await selectBoard(page, boardName);
    await expect(
      columnByName(page, 'В работе').getByText(title, { exact: true }),
    ).toBeVisible();
    await expect(
      backlogColumn(page).getByText(title, { exact: true }),
    ).toHaveCount(0);
  });

  async function createTask(page: Page, title: string) {
    await createBoardForTest(page);
    await addTask(page, title);
    await backlogColumn(page)
      .getByRole('button', { name: title, exact: true })
      .click();
  }

  test('opens task details and edits a task', async ({ page }) => {
    await signIn(page);
    await createTask(page, 'Тестовая задача');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Описание').fill('Уточнённое описание');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(page.getByLabel('Описание')).toHaveValue(
      'Уточнённое описание',
    );
  });

  test('records and shows the task path with actors and assignees', async ({
    page,
  }) => {
    await signIn(page);
    const boardName = await createBoardForTest(page);
    const title = `История задачи ${Date.now()}`;
    await addTask(page, title);
    await backlogColumn(page)
      .getByRole('button', { name: title, exact: true })
      .click();

    await chooseOption(page, 'Исполнитель', email);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await chooseOption(page, 'Колонка', 'В работе');
    await expect(columnByName(page, 'В работе').getByText(title)).toBeVisible();

    await page.keyboard.press('Escape');
    await page.reload();
    await selectBoard(page, boardName);
    await columnByName(page, 'В работе')
      .getByTestId('task-card')
      .filter({ hasText: title })
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('tab', { name: 'История' }).click();

    const events = page.getByTestId('task-history-event');
    await expect(events).toHaveCount(3);
    await expect(page.locator('[data-event-type="created"]')).toContainText(
      `${email} создал задачу`,
    );
    await expect(
      page.locator('[data-event-type="assignee_changed"]'),
    ).toContainText(`Не назначен → ${email}`);
    await expect(
      page.locator('[data-event-type="column_changed"]'),
    ).toContainText('Бэклог → В работе');
    for (const event of await events.all()) {
      const value = await event.locator('time').getAttribute('datetime');
      expect(value).toBeTruthy();
      expect(Number.isNaN(Date.parse(value!))).toBe(false);
    }
  });

  test('saves, filters, records, replaces, and clears a free-text assignee', async ({
    page,
  }) => {
    await signIn(page);
    await createBoardForTest(page);
    const title = uniqueName('Задача со свободным исполнителем');
    const externalAssignee = uniqueName('Внешний исполнитель');
    await addTask(page, title);
    await taskCard(page, title).getByRole('button').first().click();

    await chooseTextAssignee(page, externalAssignee);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.keyboard.press('Escape');

    const card = taskCard(page, title);
    await expect(
      card.getByTitle(`${externalAssignee} · имя`, { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Фильтры/ }).click();
    await chooseOption(page, 'Исполнитель', externalAssignee);
    await expect(card).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Фильтры · 1', exact: true }),
    ).toBeVisible();
    await page
      .getByText('Фильтры задач', { exact: true })
      .locator('..')
      .getByRole('button', { name: 'Сбросить', exact: true })
      .click();

    await card.getByRole('button').first().click();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(
      page
        .locator('[data-event-type="assignee_changed"]')
        .filter({ hasText: `Не назначен → ${externalAssignee}` }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await chooseAssignee(page, email);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(
      page
        .locator('[data-event-type="assignee_changed"]')
        .filter({ hasText: `${externalAssignee} → ${email}` }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await chooseAssignee(page, 'Не назначен');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(
      page
        .locator('[data-event-type="assignee_changed"]')
        .filter({ hasText: `${email} → Не назначен` }),
    ).toBeVisible();
  });

  test('moves a task with the explicit move menu and archives it', async ({
    page,
  }) => {
    await signIn(page);
    await createTask(page, 'Переносимая задача');
    await chooseOption(page, 'Колонка', 'В работе');
    await expect(
      page
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'В работе' }) })
        .getByText('Переносимая задача'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Другие действия' }).click();
    await page.getByRole('menuitem', { name: 'Архивировать задачу' }).click();
  });

  test('records server stopwatch time and a manual entry', async ({ page }) => {
    await signIn(page);
    await createTask(page, 'Задача со временем');
    await page.getByRole('button', { name: 'Запустить таймер' }).click();
    await page.getByRole('button', { name: 'Остановить таймер' }).click();
    await page.getByLabel('Продолжительность').fill('25');
    await page.getByRole('button', { name: 'Добавить время' }).click();
  });

  test('shows and downloads an attached screenshot', async ({ page }) => {
    await signIn(page);
    await createTask(page, 'Задача с файлом');
    await page
      .getByRole('dialog')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'screen.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('screen'),
      });
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'screen.txt' }).click();
    expect((await download).suggestedFilename()).toBe('screen.txt');
  });

  test('filters the board by author, assignee, topic, label, due state, and archive state', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signIn(page);
    const openFilters = () =>
      page.getByRole('button', { name: /^Фильтры/ }).click();
    await openFilters();
    await chooseOption(page, 'Автор', email);
    await openFilters();
    await chooseOption(page, 'Исполнитель', email);
    await openFilters();
    await chooseOption(page, 'Тема', 'Общее');
    await openFilters();
    await chooseOption(page, 'Метка', 'Важно');
    await openFilters();
    await chooseOption(page, 'Срок', 'Просроченные');
    await openFilters();
    const archived = page.getByLabel('Показывать архивные задачи');
    await archived.click();
    await expect(
      page.getByRole('button', { name: 'Фильтры · 6' }),
    ).toBeVisible();
  });

  test('manages members, columns, topics, and labels in board settings', async ({
    page,
  }) => {
    await signIn(page);
    const memberEmail = `member-${Date.now()}@example.test`;
    const created = await page.request.post('/api/admin/users', {
      data: {
        email: memberEmail,
        password: 'member-pass-123',
        role: 'user',
      },
    });
    expect(created.status()).toBe(201);
    await page.getByRole('button', { name: 'Настроить доску' }).click();
    await page.getByRole('tab', { name: 'Доступ' }).click();
    const memberSelect = page.getByRole('textbox', {
      name: 'Добавить пользователя',
    });
    await memberSelect.fill(memberEmail);
    await expect(
      page.getByRole('option', { name: memberEmail, exact: true }),
    ).toBeVisible();
    await memberSelect.press('ArrowDown');
    await memberSelect.press('Enter');
    await page.getByRole('button', { name: 'Добавить на доску' }).click();
    await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Добавить пользователя' }),
    ).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Колонки' }).click();
    const columnName = `Проверка ${Date.now()}`;
    await page.getByLabel('Новая колонка').fill(columnName);
    await page.getByRole('button', { name: 'Создать колонку' }).click();
    const columnRow = page.locator('.settings-column-item').filter({
      has: page.getByLabel(`Название колонки ${columnName}`),
    });
    await expect(
      columnRow.getByRole('button', {
        name: `Сохранить колонку ${columnName}`,
      }),
    ).toBeVisible();
    await columnRow
      .getByRole('button', { name: `Архивировать колонку ${columnName}` })
      .click();
    const confirmation = columnRow.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirmation).toHaveCount(0);
  });

  test('shows separate topic and label creation flows', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Настроить доску' }).click();
    await page.getByRole('tab', { name: 'Темы и метки' }).click();
    await expect(
      page.getByRole('button', { name: 'Создать тему' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Создать метку' }),
    ).toBeVisible();
  });

  test('opens the compact time view and filters entries', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Учёт времени' }).click();
    await expect(page.getByRole('dialog')).toContainText('Учёт времени');
    await page.getByLabel('Дата от').fill('01.01.2026');
    await page.getByLabel('Дата до').fill('31.12.2026');
    await chooseOption(page, 'Пользователь', email);
  });
});
