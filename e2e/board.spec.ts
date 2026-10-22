import { expect, test, type Locator, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? 'admin@example.com';
const password = process.env.E2E_PASSWORD ?? 'change-me-now';

type Department = { id: string; name: string };
type AccountRole = 'superadmin' | 'admin' | 'manager' | 'user';
type AdminAccount = {
  id: string;
  email: string;
  role: AccountRole;
  firstName?: string | null;
  lastName?: string | null;
};
type ResponsibilityGroup = {
  id: string;
  name: string;
  departmentId: string;
};
type BoardSummary = { id: string; name: string; departmentId: string };

const uniqueRun = `${Date.now()}-${process.pid}`;
let uniqueSequence = 0;

function uniqueName(prefix: string) {
  uniqueSequence += 1;
  return `${prefix} ${uniqueRun}-${uniqueSequence}`;
}

function uniqueEmail(prefix: string) {
  uniqueSequence += 1;
  return `${prefix}.${uniqueRun}.${uniqueSequence}@example.test`;
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

async function createDepartmentForTest(page: Page, name = uniqueName('Отдел')) {
  const response = await page.request.post('/api/departments', {
    data: { name },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { department: Department };
  return body.department;
}

async function createBoardApi(
  page: Page,
  departmentId: string,
  name = uniqueName('Доска'),
) {
  const response = await page.request.post('/api/boards', {
    data: { name, departmentId },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { board: BoardSummary };
  return body.board;
}

async function createAccount(
  page: Page,
  email: string,
  password: string,
  role: AccountRole,
  names: { firstName?: string; lastName?: string } = {},
) {
  const response = await page.request.post('/api/admin/users', {
    data: { email, password, role, ...names },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { user: AdminAccount };
  return body.user;
}

async function signOut(page: Page, accountEmail: string) {
  await page.getByRole('button', { name: accountEmail }).click();
  await page.getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(
    page.getByRole('img', { name: 'Логотип ТФОМС Югры' }),
  ).toBeVisible();
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

async function clickNavigationControl(navigation: Locator, name: string) {
  const control = navigation.getByRole('button', { name, exact: true });
  await expect(control).toBeAttached();
  await control.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  await expect(control).toBeVisible();
  await control.click();
}

async function selectBoard(page: Page, name: string, departmentName?: string) {
  const navigation = await openNavigation(page);
  if (departmentName) {
    const expandDepartment = navigation.getByRole('button', {
      name: `Развернуть отдел ${departmentName}`,
      exact: true,
    });
    if (await expandDepartment.isVisible()) await expandDepartment.click();
  }
  await clickNavigationControl(navigation, name);
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
  await selectBoard(page, name, department!.name);
  return name;
}

async function chooseOption(page: Page, label: string, option: string) {
  const control = page.getByRole('textbox', { name: label, exact: true });
  await control.click();
  if ((await control.getAttribute('readonly')) === null)
    await control.fill(option);
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
  test.describe.configure({ mode: 'serial' });

  test('signs in through the Russian interface', async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId('user-email')).toHaveText(email);
  });

  test('keeps primary light-theme controls and labels readable', async ({
    page,
  }) => {
    await signIn(page);
    await createBoardForTest(page);
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
      page.getByTestId('kanban-column').first().locator('.task-count'),
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

    await clickNavigationControl(navigation, 'Создать отдел');
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
    await clickNavigationControl(navigation, 'Создать доску');
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
    await clickNavigationControl(navigation, 'Создать отдел');
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

  test('closes the mobile drawer with its close control and Escape', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile-only navigation');
    await signIn(page);

    let drawer = await openNavigation(page);
    const closeButton = drawer.getByRole('button', {
      name: 'Закрыть меню досок',
    });
    await expect(closeButton).toBeVisible();
    const closeButtonBox = await closeButton.boundingBox();
    expect(closeButtonBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeButtonBox?.height).toBeGreaterThanOrEqual(44);
    await closeButton.click();
    await expect(drawer).toBeHidden();

    drawer = await openNavigation(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
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
    // Profile belongs to the right-hand user menu; achievements have their own region.
    expect(headerBox?.height).toBe(56);
    const profileBox = await header.locator('.user-menu-trigger').boundingBox();
    expect(profileBox).not.toBeNull();
    expect(profileBox!.x + profileBox!.width).toBeGreaterThanOrEqual(
      metrics.viewport - 20,
    );
    expect(profileBox!.x + profileBox!.width).toBeLessThanOrEqual(
      metrics.viewport,
    );
    if (metrics.viewport > 1100) {
      const rail = page.getByRole('complementary', {
        name: 'Команда и достижения',
      });
      await expect(rail).toBeVisible();
      const railBox = await rail.boundingBox();
      expect(railBox!.x).toBeGreaterThan(columnBox!.x);
    } else {
      await expect(page.locator('.team-mobile-bar')).toBeVisible();
    }
    expect(columnBox?.width).toBeGreaterThanOrEqual(280);
    expect(columnBox?.width).toBeLessThanOrEqual(340);
  });

  test('creates a task inline in the backlog', async ({ page }) => {
    await signIn(page);
    await createBoardForTest(page);

    const title = `Проверить задачу ${Date.now()}`;
    await addTask(page, title);
    const card = taskCard(page, title);
    await expect(
      card.getByTitle(`Автор: ${email}`, { exact: true }),
    ).toBeVisible();
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

  test('bootstrap superadmin creates accounts and controls roles and passwords', async ({
    page,
    request,
  }) => {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    const currentResponse = await page.request.get('/api/auth/me');
    expect(currentResponse.status()).toBe(200);
    const current = (await currentResponse.json()) as {
      user: AdminAccount;
    };
    expect(current.user.email).toBe(email);
    expect(current.user.role).toBe('superadmin');

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

    const selfProfileUpdate = await page.request.patch(
      `/api/admin/users/${current.user.id}`,
      { data: { firstName: 'Владислав', lastName: 'Тестов' } },
    );
    expect(selfProfileUpdate.status()).toBe(204);
    const namedCurrentResponse = await page.request.get('/api/auth/me');
    expect(namedCurrentResponse.status()).toBe(200);
    await expect(namedCurrentResponse.json()).resolves.toMatchObject({
      user: { firstName: 'Владислав', lastName: 'Тестов' },
    });
    const selfProfileRestore = await page.request.patch(
      `/api/admin/users/${current.user.id}`,
      {
        data: {
          firstName: current.user.firstName ?? null,
          lastName: current.user.lastName ?? null,
        },
      },
    );
    expect(selfProfileRestore.status()).toBe(204);

    const adminEmail = uniqueEmail('sa-admin');
    const adminPassword = 'sa-admin-pass-123';
    const userEmail = uniqueEmail('sa-user');
    const userPassword = 'sa-user-pass-123';
    await createAccount(page, adminEmail, adminPassword, 'admin', {
      firstName: 'Анна',
      lastName: 'Смирнова',
    });
    const createdUser = await createAccount(
      page,
      userEmail,
      userPassword,
      'user',
      { firstName: 'Илья', lastName: 'Петров' },
    );

    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Пользователи и права' }).click();
    await expect(page.getByText(adminEmail, { exact: true })).toBeVisible();
    await expect(page.getByText(userEmail, { exact: true })).toBeVisible();
    const generatedEmail = uniqueEmail('generated-user'),
      createForm = page.locator('.admin-user-create'),
      createPassword = createForm.getByLabel('Пароль для входа');
    await createForm.getByLabel('Email').fill(generatedEmail);
    await createForm
      .getByRole('button', { name: 'Сгенерировать и скопировать' })
      .click();
    await expect(createPassword).toHaveAttribute('type', 'text');
    const generatedPassword = await createPassword.inputValue();
    expect(generatedPassword).toHaveLength(18);
    expect(generatedPassword).toMatch(/[A-Z]/);
    expect(generatedPassword).toMatch(/[a-z]/);
    expect(generatedPassword).toMatch(/[0-9]/);
    expect(generatedPassword).toMatch(/[!@#$%&*\-_=+]/);
    await expect(
      createForm.getByText('Пароль скопирован в буфер обмена'),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(generatedPassword);
    await createForm
      .getByRole('button', { name: 'Создать пользователя' })
      .click();
    const credentials = page.getByRole('region', {
      name: 'Пароль пользователя',
    });
    await expect(credentials).toContainText(generatedEmail);
    await expect(credentials).toContainText(generatedPassword);
    const generatedLogin = await request.post('/api/auth/sign-in', {
      data: { email: generatedEmail, password: generatedPassword },
    });
    expect(generatedLogin.status()).toBe(200);
    const adminRow = page.locator('.admin-user-row').filter({
      has: page.getByText(adminEmail, { exact: true }),
    });
    const userRow = page.locator('.admin-user-row').filter({
      has: page.getByText(userEmail, { exact: true }),
    });
    await expect(
      adminRow.getByText('Смирнова Анна', { exact: true }),
    ).toBeVisible();
    await expect(
      userRow.getByText('Петров Илья', { exact: true }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: `Изменить ФИО ${userEmail}` })
      .click();
    await page.getByLabel(`Фамилия ${userEmail}`).fill('Сидоров');
    await page.getByLabel(`Имя ${userEmail}`).fill('Сергей');
    await page.getByRole('button', { name: 'Сохранить ФИО' }).click();
    await expect(
      userRow.getByText('Сидоров Сергей', { exact: true }),
    ).toBeVisible();

    await chooseOption(page, `Роль ${adminEmail}`, 'Пользователь');
    await expect(
      page.getByRole('textbox', { name: `Роль ${adminEmail}` }),
    ).toHaveValue('Пользователь');
    await chooseOption(page, `Роль ${adminEmail}`, 'Администратор');
    await expect(
      page.getByRole('textbox', { name: `Роль ${adminEmail}` }),
    ).toHaveValue('Администратор');
    await chooseOption(page, `Роль ${userEmail}`, 'Администратор');
    await chooseOption(page, `Роль ${userEmail}`, 'Пользователь');

    await page
      .getByRole('button', { name: `Сменить пароль ${userEmail}` })
      .click();
    const passwordPanel = userRow.locator('.user-action-panel'),
      updatedPasswordInput = passwordPanel.getByLabel(
        `Новый пароль для ${userEmail}`,
      );
    await passwordPanel
      .getByRole('button', { name: 'Сгенерировать и скопировать' })
      .click();
    await expect(updatedPasswordInput).toHaveAttribute('type', 'text');
    const updatedPassword = await updatedPasswordInput.inputValue();
    await expect(
      passwordPanel.getByText('Пароль скопирован в буфер обмена'),
    ).toBeVisible();
    const [passwordResponse] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'PATCH' &&
          url.pathname === `/api/admin/users/${createdUser.id}`
        );
      }),
      page.getByRole('button', { name: 'Сменить пароль', exact: true }).click(),
    ]);
    expect(passwordResponse.status()).toBe(204);
    await expect(credentials).toContainText(userEmail);
    await expect(credentials).toContainText(updatedPassword);
    await expect(page.getByLabel(`Новый пароль для ${userEmail}`)).toHaveCount(
      0,
    );
    const oldLogin = await request.post('/api/auth/sign-in', {
      data: { email: userEmail, password: userPassword },
    });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await request.post('/api/auth/sign-in', {
      data: { email: userEmail, password: updatedPassword },
    });
    expect(newLogin.status()).toBe(200);
    await expect(newLogin.json()).resolves.toMatchObject({
      user: { firstName: 'Сергей', lastName: 'Сидоров' },
    });

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

  test('shows task authors and assignees by surname and first name', async ({
    page,
  }) => {
    await signIn(page);
    const memberEmail = uniqueEmail('named-user');
    const memberPassword = 'named-user-pass-123';
    const member = await createAccount(
      page,
      memberEmail,
      memberPassword,
      'user',
      { firstName: 'Иван', lastName: 'Петров' },
    );
    const department = await createDepartmentForTest(
      page,
      uniqueName('Отдел ФИО'),
    );
    const board = await createBoardApi(
      page,
      department.id,
      uniqueName('Доска ФИО'),
    );
    const access = await page.request.put(
      `/api/admin/users/${member.id}/access`,
      {
        data: { departmentIds: [department.id], boardIds: [] },
      },
    );
    expect(access.status()).toBe(204);

    await signOut(page, email);
    await signInAs(page, memberEmail, memberPassword);
    await selectBoard(page, board.name, department.name);
    const taskTitle = uniqueName('Задача автора');
    await addTask(page, taskTitle);
    const card = taskCard(page, taskTitle);
    await expect(card).toContainText('Петров Иван');
    await card.getByRole('button').first().click();
    await expect(page.getByLabel('Автор задачи')).toContainText('Петров Иван');

    await page.getByRole('button', { name: 'Редактировать' }).click();
    await page.getByLabel('Исполнитель').click();
    await expect(
      page.getByRole('option', {
        name: `Петров Иван · ${memberEmail}`,
        exact: true,
      }),
    ).toBeVisible();
  });

  test('superadmin creates a responsibility group and manager only controls its members', async ({
    page,
  }) => {
    await signIn(page);
    const department = await createDepartmentForTest(
        page,
        uniqueName('Отдел ответственности'),
      ),
      outsideDepartment = await createDepartmentForTest(
        page,
        uniqueName('Чужой отдел'),
      ),
      managerEmail = uniqueEmail('responsible'),
      managerPassword = 'responsible-pass-123',
      memberEmail = uniqueEmail('group-member'),
      memberPassword = 'group-member-pass-123',
      adminMemberEmail = uniqueEmail('group-admin'),
      outsiderEmail = uniqueEmail('group-outsider'),
      manager = await createAccount(
        page,
        managerEmail,
        managerPassword,
        'user',
      ),
      member = await createAccount(page, memberEmail, memberPassword, 'user'),
      adminMember = await createAccount(
        page,
        adminMemberEmail,
        'group-admin-pass-123',
        'admin',
      ),
      outsider = await createAccount(
        page,
        outsiderEmail,
        'group-outsider-pass-123',
        'user',
      ),
      groupName = uniqueName('Первая линия');

    await page.reload();
    await page.getByRole('button', { name: email }).click();
    await page.getByRole('menuitem', { name: 'Пользователи и права' }).click();
    await expect(
      page.getByRole('heading', { name: 'Группы отделов' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Создать группу' }).click();
    const dialog = page.getByRole('dialog', { name: 'Новая группа' });
    await dialog.getByLabel('Название группы').fill(groupName);
    await chooseOption(page, 'Отдел', department.name);
    await chooseOption(page, 'Ответственный', `${managerEmail} · Пользователь`);
    const members = dialog.getByRole('textbox', { name: 'Сотрудники группы' });
    await members.click();
    await page
      .getByRole('option', {
        name: `${memberEmail} · Пользователь`,
        exact: true,
      })
      .click();
    await members.click();
    await page
      .getByRole('option', {
        name: `${adminMemberEmail} · Администратор`,
        exact: true,
      })
      .click();
    await dialog.getByRole('button', { name: 'Сохранить группу' }).click();
    const groupCard = page.locator('.responsibility-card').filter({
      has: page.getByRole('heading', { name: groupName, exact: true }),
    });
    await expect(groupCard).toContainText(department.name);
    await expect(groupCard).toContainText('2 сотрудников');

    const managerCannotBeCreatedDirectly = await page.request.post(
      '/api/admin/users',
      {
        data: {
          email: uniqueEmail('invalid-manager'),
          password: 'invalid-manager-pass-123',
          role: 'manager',
        },
      },
    );
    expect(managerCannotBeCreatedDirectly.status()).toBe(409);
    expect(await managerCannotBeCreatedDirectly.json()).toEqual({
      code: 'MANAGER_ROLE_REQUIRES_GROUP',
    });

    await page.keyboard.press('Escape');
    await expect(page.getByText('Группы отделов', { exact: true })).toHaveCount(
      0,
    );
    await signOut(page, email);
    await signInAs(page, managerEmail, managerPassword);
    const me = await page.request.get('/api/auth/me');
    await expect(me.json()).resolves.toMatchObject({
      user: { id: manager.id, role: 'manager' },
    });
    await page.getByRole('button', { name: managerEmail }).click();
    await page.getByRole('menuitem', { name: 'Пользователи и права' }).click();
    await expect(page.locator('.admin-user-create')).toHaveCount(0);
    await expect(page.getByText(memberEmail, { exact: true })).toBeVisible();
    await expect(
      page.getByText(adminMemberEmail, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(outsiderEmail, { exact: true })).toHaveCount(0);

    const managedUsers = await page.request.get(
      '/api/admin/users?status=active',
    );
    expect(managedUsers.status()).toBe(200);
    const visibleIds = (
      (await managedUsers.json()) as { users: AdminAccount[] }
    ).users.map((item) => item.id);
    expect(visibleIds).toEqual(
      expect.arrayContaining([member.id, adminMember.id]),
    );
    expect(visibleIds).not.toContain(outsider.id);
    const ownGroups = await page.request.get('/api/admin/groups');
    expect(ownGroups.status()).toBe(200);
    const ownGroupsBody = (await ownGroups.json()) as {
      groups: ResponsibilityGroup[];
    };
    expect(ownGroupsBody).toMatchObject({
      groups: [{ name: groupName, departmentId: department.id }],
    });

    const permittedAccess = await page.request.put(
      `/api/admin/users/${member.id}/access`,
      { data: { departmentIds: [department.id], boardIds: [] } },
    );
    expect(permittedAccess.status()).toBe(204);
    const outsideAccess = await page.request.put(
      `/api/admin/users/${member.id}/access`,
      { data: { departmentIds: [outsideDepartment.id], boardIds: [] } },
    );
    expect(outsideAccess.status()).toBe(403);
    expect(await outsideAccess.json()).toEqual({
      code: 'OUTSIDE_RESPONSIBILITY_SCOPE',
    });
    const outsiderPatch = await page.request.patch(
      `/api/admin/users/${outsider.id}`,
      { data: { firstName: 'Недоступен' } },
    );
    expect(outsiderPatch.status()).toBe(403);
    const forbiddenRoleChange = await page.request.patch(
      `/api/admin/users/${member.id}`,
      { data: { role: 'admin' } },
    );
    expect(forbiddenRoleChange.status()).toBe(403);
    const forbiddenAdminPassword = await page.request.patch(
      `/api/admin/users/${adminMember.id}`,
      { data: { password: 'manager-must-not-escalate-123' } },
    );
    expect(forbiddenAdminPassword.status()).toBe(403);
    const adminMemberRow = page.locator('.admin-user-row').filter({
      has: page.getByText(adminMemberEmail, { exact: true }),
    });
    await expect(
      adminMemberRow.getByRole('button', {
        name: `Сменить пароль ${adminMemberEmail}`,
      }),
    ).toHaveCount(0);

    await page.keyboard.press('Escape');
    await signOut(page, managerEmail);
    await signIn(page);
    const deleted = await page.request.delete(
      `/api/admin/groups/${ownGroupsBody.groups[0]!.id}`,
    );
    expect(deleted.status()).toBe(204);
    const formerManager = await page.request.get(
      '/api/admin/users?status=active',
    );
    expect(formerManager.status()).toBe(200);
    expect(
      ((await formerManager.json()) as { users: AdminAccount[] }).users.find(
        (item) => item.id === manager.id,
      )?.role,
    ).toBe('user');
  });

  test('admin sees every board, manages user access, and cannot manage elevated accounts', async ({
    page,
    request,
  }) => {
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    const meResponse = await page.request.get('/api/auth/me');
    const me = (await meResponse.json()) as { user: AdminAccount };
    expect(me.user.role).toBe('superadmin');

    const adminEmail = uniqueEmail('global-admin');
    const adminPassword = 'global-admin-pass-123';
    const userEmail = uniqueEmail('global-user');
    const userPassword = 'global-user-pass-123';
    const admin = await createAccount(page, adminEmail, adminPassword, 'admin');
    const ordinaryUser = await createAccount(
      page,
      userEmail,
      userPassword,
      'user',
    );
    const department = await createDepartmentForTest(
      page,
      uniqueName('Глобальный отдел'),
    );
    const board = await createBoardApi(
      page,
      department.id,
      uniqueName('Глобальная доска'),
    );

    await signOut(page, email);
    await signInAs(page, adminEmail, adminPassword);
    const visibleBoards = await page.request.get('/api/boards');
    expect(visibleBoards.status()).toBe(200);
    const visibleBoardNames = (
      (await visibleBoards.json()) as {
        boards: BoardSummary[];
      }
    ).boards.map((item) => item.name);
    expect(visibleBoardNames).toContain(board.name);
    await selectBoard(page, board.name);

    await page.getByRole('button', { name: adminEmail }).click();
    await page.getByRole('menuitem', { name: 'Пользователи и права' }).click();
    const adminCreatedEmail = uniqueEmail('admin-generated-user'),
      createForm = page.locator('.admin-user-create');
    await createForm.getByLabel('Email').fill(adminCreatedEmail);
    await createForm
      .getByRole('button', { name: 'Сгенерировать и скопировать' })
      .click();
    const adminGeneratedPassword = await createForm
      .getByLabel('Пароль для входа')
      .inputValue();
    await createForm
      .getByRole('button', { name: 'Создать пользователя' })
      .click();
    await expect(
      page.getByRole('region', { name: 'Пароль пользователя' }),
    ).toContainText(adminGeneratedPassword);
    const adminCreatedLogin = await request.post('/api/auth/sign-in', {
      data: {
        email: adminCreatedEmail,
        password: adminGeneratedPassword,
      },
    });
    expect(adminCreatedLogin.status()).toBe(200);

    const managedRow = page.locator('.admin-user-row').filter({
      has: page.getByText(userEmail, { exact: true }),
    });
    await managedRow
      .getByRole('button', { name: `Сменить пароль ${userEmail}` })
      .click();
    const passwordPanel = managedRow.locator('.user-action-panel');
    await passwordPanel
      .getByRole('button', { name: 'Сгенерировать и скопировать' })
      .click();
    const adminResetPassword = await passwordPanel
      .getByLabel(`Новый пароль для ${userEmail}`)
      .inputValue();
    const [adminPasswordResponse] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'PATCH' &&
          url.pathname === `/api/admin/users/${ordinaryUser.id}`
        );
      }),
      passwordPanel
        .getByRole('button', { name: 'Сменить пароль', exact: true })
        .click(),
    ]);
    expect(adminPasswordResponse.status()).toBe(204);
    const adminResetLogin = await request.post('/api/auth/sign-in', {
      data: { email: userEmail, password: adminResetPassword },
    });
    expect(adminResetLogin.status()).toBe(200);

    for (const role of ['admin', 'superadmin'] as const) {
      const forbiddenCreation = await page.request.post('/api/admin/users', {
        data: {
          email: uniqueEmail(`admin-cannot-create-${role}`),
          password: 'forbidden-create-pass-123',
          role,
        },
      });
      expect(forbiddenCreation.status()).toBe(403);
      expect(await forbiddenCreation.json()).toEqual({ code: 'FORBIDDEN' });
    }
    const forbiddenRoleChange = await page.request.patch(
      `/api/admin/users/${me.user.id}`,
      { data: { role: 'user' } },
    );
    expect(forbiddenRoleChange.status()).toBe(403);
    const forbiddenPasswordChange = await page.request.patch(
      `/api/admin/users/${me.user.id}`,
      { data: { password: 'admin-cannot-change-123' } },
    );
    expect(forbiddenPasswordChange.status()).toBe(403);
    const forbiddenArchive = await page.request.delete(
      `/api/admin/users/${me.user.id}`,
    );
    expect(forbiddenArchive.status()).toBe(403);
    const forbiddenAccess = await page.request.put(
      `/api/admin/users/${me.user.id}/access`,
      { data: { departmentIds: [department.id], boardIds: [board.id] } },
    );
    expect(forbiddenAccess.status()).toBe(404);

    const assigned = await page.request.put(
      `/api/admin/users/${ordinaryUser.id}/access`,
      { data: { departmentIds: [department.id], boardIds: [] } },
    );
    expect(assigned.status()).toBe(204);
    const directory = await page.request.get('/api/admin/users');
    expect(directory.status()).toBe(200);
    const managedUsers = (
      (await directory.json()) as {
        users: Array<AdminAccount & { departmentIds: string[] }>;
      }
    ).users;
    const managedOrdinaryUser = managedUsers.find(
      (item) => item.id === ordinaryUser.id,
    );
    expect(managedOrdinaryUser?.role).toBe('user');
    expect(managedOrdinaryUser?.departmentIds).toEqual([department.id]);
    expect(managedUsers.some((item) => item.id === admin.id)).toBe(false);
    expect(managedUsers.some((item) => item.id === me.user.id)).toBe(false);
  });

  test('ordinary-user access is a union, hides out-of-scope boards, and revokes each path safely', async ({
    page,
  }) => {
    await signIn(page);
    const userEmail = uniqueEmail('scope-user');
    const userPassword = 'scope-user-pass-123';
    const ordinaryUser = await createAccount(
      page,
      userEmail,
      userPassword,
      'user',
    );
    const department = await createDepartmentForTest(
      page,
      uniqueName('Доступный отдел'),
    );
    const siblingDepartment = await createDepartmentForTest(
      page,
      uniqueName('Соседний отдел'),
    );
    const departmentBoard = await createBoardApi(
      page,
      department.id,
      uniqueName('Доска отдела'),
    );
    const directBoard = await createBoardApi(
      page,
      siblingDepartment.id,
      uniqueName('Прямая доска'),
    );
    const hiddenSiblingBoard = await createBoardApi(
      page,
      siblingDepartment.id,
      uniqueName('Скрытая соседняя доска'),
    );
    const assigned = await page.request.put(
      `/api/admin/users/${ordinaryUser.id}/access`,
      { data: { departmentIds: [department.id], boardIds: [directBoard.id] } },
    );
    expect(assigned.status()).toBe(204);
    const inheritedFutureBoard = await createBoardApi(
      page,
      department.id,
      uniqueName('Будущая доска отдела'),
    );

    await signOut(page, email);
    await signInAs(page, userEmail, userPassword);
    const initialBoards = await page.request.get('/api/boards');
    expect(initialBoards.status()).toBe(200);
    const initialNames = (
      (await initialBoards.json()) as {
        boards: BoardSummary[];
      }
    ).boards.map((item) => item.name);
    expect(initialNames).toEqual(
      expect.arrayContaining([
        departmentBoard.name,
        inheritedFutureBoard.name,
        directBoard.name,
      ]),
    );
    expect(initialNames).not.toContain(hiddenSiblingBoard.name);
    const renamedDirectBoard = uniqueName('Переименованная прямая доска');
    const renameDirectBoard = await page.request.patch(
      `/api/boards/${directBoard.id}`,
      { data: { name: renamedDirectBoard } },
    );
    expect(renameDirectBoard.status()).toBe(204);
    directBoard.name = renamedDirectBoard;
    await selectBoard(page, inheritedFutureBoard.name);
    const scopedNavigation = await openNavigation(page);
    await expect(
      scopedNavigation.getByRole('button', {
        name: `Действия отдела ${siblingDepartment.name}`,
      }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    const departmentBoardResponse = await page.request.get(
      `/api/boards/${departmentBoard.id}`,
    );
    expect(departmentBoardResponse.status()).toBe(200);
    const departmentBoardData = (await departmentBoardResponse.json()) as {
      columns: Array<{ id: string }>;
    };
    const trackedTaskResponse = await page.request.post(
      `/api/boards/${departmentBoard.id}/tasks`,
      {
        data: {
          columnId: departmentBoardData.columns[0]!.id,
          title: uniqueName('Задача перед отзывом доступа'),
          assigneeId: ordinaryUser.id,
        },
      },
    );
    expect(trackedTaskResponse.status()).toBe(201);
    const trackedTask = (await trackedTaskResponse.json()) as {
      task: { id: string };
    };
    const timerResponse = await page.request.post(
      `/api/tasks/${trackedTask.task.id}/timer/start`,
    );
    expect(timerResponse.status()).toBe(201);
    const timer = (await timerResponse.json()) as {
      entry: { id: string };
    };

    const hiddenDetail = await page.request.get(
      `/api/boards/${hiddenSiblingBoard.id}`,
    );
    expect(hiddenDetail.status()).toBe(404);
    expect(await hiddenDetail.json()).toEqual({ code: 'BOARD_NOT_FOUND' });
    const hiddenNested = await page.request.get(
      `/api/boards/${hiddenSiblingBoard.id}/members`,
    );
    expect(hiddenNested.status()).toBe(404);
    expect(await hiddenNested.json()).toEqual({ code: 'BOARD_NOT_FOUND' });
    const hiddenDepartmentMutation = await page.request.patch(
      `/api/departments/${siblingDepartment.id}`,
      { data: { name: uniqueName('Недоступное переименование') } },
    );
    expect(hiddenDepartmentMutation.status()).toBe(404);
    const hiddenDepartmentMembers = await page.request.get(
      `/api/departments/${siblingDepartment.id}/members`,
    );
    expect(hiddenDepartmentMembers.status()).toBe(403);

    await signOut(page, userEmail);
    await signIn(page);
    const revokeDepartment = await page.request.put(
      `/api/admin/users/${ordinaryUser.id}/access`,
      { data: { departmentIds: [], boardIds: [directBoard.id] } },
    );
    expect(revokeDepartment.status()).toBe(204);
    const timeEntriesResponse = await page.request.get(
      `/api/boards/${departmentBoard.id}/time-entries`,
    );
    expect(timeEntriesResponse.status()).toBe(200);
    const timeEntries = (await timeEntriesResponse.json()) as {
      entries: Array<{ id: string; stoppedAt: string | null }>;
    };
    expect(
      timeEntries.entries.find((entry) => entry.id === timer.entry.id)
        ?.stoppedAt,
    ).not.toBeNull();
    const taskAfterRevokeResponse = await page.request.get(
      `/api/boards/${departmentBoard.id}`,
    );
    const taskAfterRevoke = (await taskAfterRevokeResponse.json()) as {
      columns: Array<{
        tasks: Array<{ id: string; assigneeId: string | null }>;
      }>;
    };
    expect(
      taskAfterRevoke.columns
        .flatMap((column) => column.tasks)
        .find((task) => task.id === trackedTask.task.id)?.assigneeId,
    ).toBeNull();
    const historyResponse = await page.request.get(
      `/api/boards/${departmentBoard.id}/tasks/${trackedTask.task.id}/history`,
    );
    const history = (await historyResponse.json()) as {
      events: Array<{
        type: string;
        fromAssignee: { id: string } | null;
        toAssignee: { id: string } | null;
      }>;
    };
    expect(
      history.events.some(
        (event) =>
          event.type === 'assignee_changed' &&
          event.fromAssignee?.id === ordinaryUser.id &&
          event.toAssignee === null,
      ),
    ).toBe(true);
    await signOut(page, email);
    await signInAs(page, userEmail, userPassword);
    const afterDepartmentRevoke = await page.request.get('/api/boards');
    expect(
      (
        (await afterDepartmentRevoke.json()) as { boards: BoardSummary[] }
      ).boards.map((item) => item.name),
    ).toEqual([directBoard.name]);
    const directStillWorks = await page.request.get(
      `/api/boards/${directBoard.id}`,
    );
    expect(directStillWorks.status()).toBe(200);

    await signOut(page, userEmail);
    await signIn(page);
    const revokeDirect = await page.request.put(
      `/api/admin/users/${ordinaryUser.id}/access`,
      { data: { departmentIds: [], boardIds: [] } },
    );
    expect(revokeDirect.status()).toBe(204);
    await signOut(page, email);
    await signInAs(page, userEmail, userPassword);
    const afterAllRevoke = await page.request.get('/api/boards');
    expect(
      ((await afterAllRevoke.json()) as { boards: BoardSummary[] }).boards,
    ).toEqual([]);
    const directRevoked = await page.request.get(
      `/api/boards/${directBoard.id}`,
    );
    expect(directRevoked.status()).toBe(404);
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
      { data: { userId: createdUser.user.id } },
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
    await clickNavigationControl(navigation, 'Создать отдел');
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
    const board = page.getByTestId('board-scroll');
    const card = backlog.getByTestId('task-card').filter({
      has: page.getByText(title, { exact: true }),
    });

    const handle = card.getByRole('button', {
        name: `Переместить «${title}»`,
      }),
      cardBox = await card.boundingBox(),
      handleBox = await handle.boundingBox(),
      targetBox = await inProgress.boundingBox(),
      initialBoardScrollLeft = await board.evaluate(
        (element) => element.scrollLeft,
      );
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
      placeholderBox = await card.boundingBox(),
      draggedBoardScrollLeft = await board.evaluate(
        (element) => element.scrollLeft,
      );
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1.5);
    for (const rect of samples) {
      expect(Math.abs(rect.left - expectedLeft)).toBeLessThanOrEqual(4);
      expect(rect.left).toBeGreaterThanOrEqual(targetBox!.x - 4);
      expect(rect.right).toBeLessThanOrEqual(
        targetBox!.x + targetBox!.width + 4,
      );
    }
    // DndContext may horizontally auto-scroll the board while the pointer is
    // near its edge. Compare positions in the board's scroll coordinate space,
    // not viewport coordinates that move by the current scrollLeft.
    expect(
      Math.abs(
        placeholderBox!.x +
          draggedBoardScrollLeft -
          (cardBox!.x + initialBoardScrollLeft),
      ),
    ).toBeLessThanOrEqual(1);

    await page.mouse.move(targetBox!.x + 8, targetBox!.y + 110, { steps: 8 });
    await expect(inProgress).toHaveClass(/drop-target/);
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
    await taskCard(page, title).getByRole('button').first().click();
  }

  test('opens task details and edits a task', async ({ page }) => {
    await signIn(page);
    await createTask(page, 'Тестовая задача');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Описание задачи')).toContainText(
      'Описание пока не добавлено.',
    );
    await expect(
      page.getByRole('textbox', { name: 'Описание', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Редактировать' }).click();
    await page.getByLabel('Описание').fill('Уточнённое описание');
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(page.getByLabel('Описание задачи')).toContainText(
      'Уточнённое описание',
    );
    await page.getByRole('button', { name: 'Редактировать' }).click();
    await page.getByLabel('Описание').fill('Не сохранять это значение');
    await page.getByRole('button', { name: 'Отменить редактирование' }).click();
    await page.getByRole('button', { name: 'Отбросить изменения' }).click();
    await expect(page.getByLabel('Описание задачи')).toContainText(
      'Уточнённое описание',
    );
    await expect(
      page.getByRole('textbox', { name: 'Описание', exact: true }),
    ).toHaveCount(0);
  });

  test('keeps comments unread until the recipient opens the task', async ({
    page,
    browser,
  }) => {
    await signIn(page);
    const other = await createAccount(
      page,
      uniqueEmail('commenter'),
      'comments-pass-123',
      'admin',
    );
    const department = await createDepartmentForTest(page);
    const board = await createBoardApi(page, department.id);
    const payload = await (
      await page.request.get(`/api/boards/${board.id}`)
    ).json();
    const title = uniqueName('Непрочитанное обсуждение');
    const { task } = await (
      await page.request.post(`/api/boards/${board.id}/tasks`, {
        data: { title, columnId: payload.columns[0].id, assigneeId: other.id },
      })
    ).json();
    const context = await browser.newContext();
    try {
      await context.request.post(
        `${new URL(page.url()).origin}/api/auth/sign-in`,
        {
          data: { email: other.email, password: 'comments-pass-123' },
        },
      );
      const response = await context.request.post(
        `${new URL(page.url()).origin}/api/boards/${board.id}/tasks/${task.id}/comments`,
        {
          data: { body: 'Нужна проверка результата' },
        },
      );
      expect(response.status()).toBe(201);
      const ownBoard = await (
        await context.request.get(
          `${new URL(page.url()).origin}/api/boards/${board.id}`,
        )
      ).json();
      expect(ownBoard.columns[0].tasks[0].unreadComments).toBe(0);
      await page.reload();
      await selectBoard(page, board.name, department.name);
      const card = taskCard(page, title);
      await expect(card.getByLabel('Новые комментарии: 1')).toBeVisible();
      await card.locator('.card-open').click();
      await expect(page.getByTestId('task-comment')).toContainText(
        'Нужна проверка результата',
      );
      await expect
        .poll(async () => {
          const data = await (
            await page.request.get(`/api/boards/${board.id}`)
          ).json();
          return data.columns[0].tasks[0].unreadComments;
        })
        .toBe(0);
      await page
        .getByRole('button', { name: 'Закрыть задачу', exact: true })
        .click();
      await expect(card.locator('.task-unread')).toHaveCount(0);
      await page.reload();
      await selectBoard(page, board.name, department.name);
      await expect(taskCard(page, title).locator('.task-unread')).toHaveCount(
        0,
      );
    } finally {
      await context.close();
    }
  });

  test('shows a task preview and lets participants discuss it', async ({
    page,
  }) => {
    await signIn(page);
    await createTask(page, 'Задача для обсуждения');

    const drawer = page.getByRole('dialog', {
      name: 'Задача Задача для обсуждения',
    });
    await expect(drawer).toHaveClass(/task-modal/);
    const bounds = await drawer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(
      Math.abs(bounds!.x + bounds!.width / 2 - page.viewportSize()!.width / 2),
    ).toBeLessThan(2);
    await expect(
      drawer.getByRole('textbox', { name: 'Название', exact: true }),
    ).toHaveCount(0);
    await expect(drawer.getByRole('textbox', { name: 'Описание' })).toHaveCount(
      0,
    );
    await expect(drawer.getByLabel('Содержание задачи')).toContainText(
      'Не назначен',
    );
    await expect(drawer.getByLabel('Содержание задачи')).toContainText(
      'Без срока',
    );
    await expect(page.getByText('Комментариев пока нет')).toBeVisible();
    await page
      .getByLabel('Новый комментарий')
      .fill('Проверил постановку, можно брать в работу.');
    await page.getByRole('tab', { name: 'История', exact: true }).click();
    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await expect(page.getByLabel('Новый комментарий')).toHaveValue(
      'Проверил постановку, можно брать в работу.',
    );
    await page
      .getByRole('button', { name: 'Закрыть задачу', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Отменить несохранённые изменения?' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Отменить несохранённые изменения?' }),
    ).toBeHidden();
    await page.getByRole('button', { name: 'Отправить комментарий' }).click();
    const comment = page.getByTestId('task-comment');
    await expect(comment).toContainText(email);
    await expect(comment).toContainText(
      'Проверил постановку, можно брать в работу.',
    );
    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await page
      .getByRole('button', { name: 'Редактировать', exact: true })
      .click();
    await drawer
      .getByRole('textbox', { name: 'Название', exact: true })
      .fill('Несохранённое название');
    await page.getByRole('button', { name: 'Отменить редактирование' }).click();
    await page.getByRole('button', { name: 'Продолжить работу' }).click();
    await expect(
      drawer.getByRole('textbox', { name: 'Название', exact: true }),
    ).toHaveValue('Несохранённое название');
    await page.getByRole('button', { name: 'Отменить редактирование' }).click();
    await page.getByRole('button', { name: 'Отбросить изменения' }).click();
    await expect(
      drawer.getByRole('heading', {
        name: 'Задача для обсуждения',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Другие действия' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => {
        const modalBox = await drawer.boundingBox();
        const menuBox = await menu.boundingBox();
        return Boolean(
          modalBox &&
          menuBox &&
          menuBox.x >= modalBox.x &&
          menuBox.x + menuBox.width <= modalBox.x + modalBox.width,
        );
      })
      .toBe(true);
    await page.getByRole('menuitem', { name: 'Удалить задачу' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Удалить задачу?' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Удалить навсегда' }).click();
    await expect(taskCard(page, 'Задача для обсуждения')).toHaveCount(0);
  });

  test('enforces task deletion ownership and superadmin override', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile',
      'Role enforcement is API-level and does not depend on viewport',
    );
    await signIn(page);
    const userEmail = uniqueEmail('delete-user');
    const adminEmail = uniqueEmail('delete-admin');
    const userPassword = 'delete-user-pass-123';
    const adminPassword = 'delete-admin-pass-123';
    const ordinaryUser = await createAccount(
      page,
      userEmail,
      userPassword,
      'user',
    );
    await createAccount(page, adminEmail, adminPassword, 'admin');
    const department = await createDepartmentForTest(
      page,
      uniqueName('Отдел удаления'),
    );
    const board = await createBoardApi(
      page,
      department.id,
      uniqueName('Доска удаления'),
    );
    const access = await page.request.put(
      `/api/admin/users/${ordinaryUser.id}/access`,
      { data: { departmentIds: [], boardIds: [board.id] } },
    );
    expect(access.status()).toBe(204);
    const boardResponse = await page.request.get(`/api/boards/${board.id}`);
    const boardData = (await boardResponse.json()) as {
      columns: Array<{ id: string }>;
    };
    const superTaskResponse = await page.request.post(
      `/api/boards/${board.id}/tasks`,
      {
        data: {
          columnId: boardData.columns[0]!.id,
          title: uniqueName('Задача суперадминистратора'),
        },
      },
    );
    const superTask = (await superTaskResponse.json()) as {
      task: { id: string };
    };

    await signOut(page, email);
    await signInAs(page, userEmail, userPassword);
    const forbiddenUserDelete = await page.request.delete(
      `/api/boards/${board.id}/tasks/${superTask.task.id}`,
    );
    expect(forbiddenUserDelete.status()).toBe(403);
    const comment = await page.request.post(
      `/api/boards/${board.id}/tasks/${superTask.task.id}/comments`,
      { data: { body: 'Комментарий другого участника' } },
    );
    expect(comment.status()).toBe(201);
    const ownTaskResponse = await page.request.post(
      `/api/boards/${board.id}/tasks`,
      {
        data: {
          columnId: boardData.columns[0]!.id,
          title: uniqueName('Собственная задача пользователя'),
        },
      },
    );
    const ownTask = (await ownTaskResponse.json()) as { task: { id: string } };
    expect(
      (
        await page.request.delete(
          `/api/boards/${board.id}/tasks/${ownTask.task.id}`,
        )
      ).status(),
    ).toBe(204);

    await signOut(page, userEmail);
    await signInAs(page, adminEmail, adminPassword);
    expect(
      (
        await page.request.delete(
          `/api/boards/${board.id}/tasks/${superTask.task.id}`,
        )
      ).status(),
    ).toBe(403);
    const ownAdminTaskResponse = await page.request.post(
      `/api/boards/${board.id}/tasks`,
      {
        data: {
          columnId: boardData.columns[0]!.id,
          title: uniqueName('Собственная задача администратора'),
        },
      },
    );
    const ownAdminTask = (await ownAdminTaskResponse.json()) as {
      task: { id: string };
    };
    expect(
      (
        await page.request.delete(
          `/api/boards/${board.id}/tasks/${ownAdminTask.task.id}`,
        )
      ).status(),
    ).toBe(204);
    const adminTaskResponse = await page.request.post(
      `/api/boards/${board.id}/tasks`,
      {
        data: {
          columnId: boardData.columns[0]!.id,
          title: uniqueName('Задача администратора для удаления суперadmin'),
        },
      },
    );
    const adminTask = (await adminTaskResponse.json()) as {
      task: { id: string };
    };

    await signOut(page, adminEmail);
    await signIn(page);
    const comments = await page.request.get(
      `/api/boards/${board.id}/tasks/${superTask.task.id}/comments`,
    );
    expect(
      (
        (await comments.json()) as {
          comments: Array<{ body: string }>;
        }
      ).comments[0]?.body,
    ).toBe('Комментарий другого участника');
    expect(
      (
        await page.request.delete(
          `/api/boards/${board.id}/tasks/${adminTask.task.id}`,
        )
      ).status(),
    ).toBe(204);
  });

  test('records and shows the task path with actors and assignees', async ({
    page,
  }) => {
    await signIn(page);
    const boardName = await createBoardForTest(page);
    const title = `История задачи ${Date.now()}`;
    await addTask(page, title);
    await taskCard(page, title).getByRole('button').first().click();

    await page.getByRole('button', { name: 'Редактировать' }).click();
    await chooseOption(page, 'Исполнитель', email);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.getByRole('button', { name: 'Редактировать' }).click();
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
    const boardName = await createBoardForTest(page);
    const title = uniqueName('Задача со свободным исполнителем');
    const externalAssignee = uniqueName('Внешний исполнитель');
    await addTask(page, title);
    await taskCard(page, title).getByRole('button').first().click();

    await page.getByRole('button', { name: 'Редактировать' }).click();
    await chooseTextAssignee(page, externalAssignee);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page
      .getByRole('button', { name: 'Закрыть задачу', exact: true })
      .click();
    await expect(page.locator('.task-modal')).toBeHidden();

    const card = taskCard(page, title);
    await expect(
      card.getByTitle(`Исполнитель: ${externalAssignee} · без учётной записи`, {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Фильтры/ }).click();
    await chooseOption(page, 'Исполнитель', externalAssignee);
    await expect(card).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Фильтры · 1', exact: true }),
    ).toBeVisible();
    const filterTrigger = page.getByRole('button', {
      name: 'Фильтры · 1',
      exact: true,
    });
    const filterTitle = page.getByText('Фильтры задач', { exact: true });
    if (await filterTitle.isVisible()) {
      await page.getByRole('heading', { name: boardName, exact: true }).click();
      await expect(filterTitle).toBeHidden();
    }
    await filterTrigger.click();
    await expect(filterTitle).toBeVisible();
    await page
      .getByText('Фильтры задач', { exact: true })
      .locator('..')
      .getByRole('button', { name: 'Сбросить', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Фильтры', exact: true }),
    ).toBeVisible();
    await page.getByRole('heading', { name: boardName, exact: true }).click();
    await expect(filterTitle).toBeHidden();

    await card.getByRole('button').first().click();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(
      page
        .locator('[data-event-type="assignee_changed"]')
        .filter({ hasText: `Не назначен → ${externalAssignee}` }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать' }).click();
    await chooseAssignee(page, email);
    await page.getByRole('button', { name: 'Сохранить изменения' }).click();
    await page.getByRole('tab', { name: 'История' }).click();
    await expect(
      page
        .locator('[data-event-type="assignee_changed"]')
        .filter({ hasText: `${externalAssignee} → ${email}` }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Задача', exact: true }).click();
    await page.getByRole('button', { name: 'Редактировать' }).click();
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
    await page.getByRole('button', { name: 'Редактировать' }).click();
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
    await page.getByText('Добавить время вручную', { exact: true }).click();
    await page.getByLabel('Продолжительность').fill('25');
    await page.getByRole('button', { name: 'Добавить время' }).click();
  });

  test('previews and downloads an attached screenshot', async ({ page }) => {
    await signIn(page);
    await createTask(page, 'Задача с файлом');
    await page
      .getByRole('dialog')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'screen.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nJ0AAAAASUVORK5CYII=',
          'base64',
        ),
      });
    await page.getByRole('button', { name: 'Предпросмотр screen.png' }).click();
    const preview = page.getByRole('dialog', {
      name: 'Предпросмотр: screen.png',
    });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole('img', { name: 'screen.png' }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await preview.getByRole('link', { name: 'Скачать оригинал' }).click();
    expect((await download).suggestedFilename()).toBe('screen.png');
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(
      page.getByRole('dialog', { name: 'Задача Задача с файлом' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: 'Задача Задача с файлом' }),
    ).toBeHidden();
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
    await memberSelect.click();
    const memberOption = page.getByRole('option', {
      name: memberEmail,
      exact: true,
    });
    await expect(memberOption).toBeVisible();
    await memberOption.click();
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
