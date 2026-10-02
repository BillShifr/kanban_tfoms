import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dockerfiles = [
  new URL('../Dockerfile', import.meta.url),
  new URL('../../web/Dockerfile', import.meta.url),
];
const apiDockerfile = readFileSync(dockerfiles[0]!, 'utf8');
const productionCompose = readFileSync(
  new URL('../../../compose.prod.yml', import.meta.url),
  'utf8',
);
const developmentCompose = readFileSync(
  new URL('../../../docker-compose.yml', import.meta.url),
  'utf8',
);
const autoDeployUrl = new URL(
  '../../../deploy/auto-deploy.sh',
  import.meta.url,
);
const autoDeploy = readFileSync(autoDeployUrl, 'utf8');
const startStackUrl = new URL(
  '../../../deploy/start-stack.sh',
  import.meta.url,
);
const startStack = readFileSync(startStackUrl, 'utf8');
const installAutoDeployUrl = new URL(
  '../../../deploy/install-autodeploy.sh',
  import.meta.url,
);
const installAutoDeploy = readFileSync(installAutoDeployUrl, 'utf8');
const stopStackUrl = new URL('../../../deploy/stop-stack.sh', import.meta.url);
const composeService = readFileSync(
  new URL('../../../deploy/systemd/kanban-compose.service', import.meta.url),
  'utf8',
);
const autoDeployService = readFileSync(
  new URL('../../../deploy/systemd/kanban-autodeploy.service', import.meta.url),
  'utf8',
);
const ciWorkflow = readFileSync(
  new URL('../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const autoDeployTimer = readFileSync(
  new URL('../../../deploy/systemd/kanban-autodeploy.timer', import.meta.url),
  'utf8',
);

describe('container deployment configuration', () => {
  it('fully qualifies every external base image for deterministic Podman builds', () => {
    for (const dockerfile of dockerfiles) {
      const stages = new Set<string>();
      const lines = readFileSync(dockerfile, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('FROM '));

      for (const line of lines) {
        const [, image, , stage] = line.split(/\s+/);
        if (stages.has(image!)) continue;
        expect(image).toMatch(/^[a-z0-9.-]+\.[a-z]+\//);
        if (stage) stages.add(stage);
      }
    }
  });

  it('uses a shell-free Compose healthcheck that works with OCI images', () => {
    expect(apiDockerfile).not.toContain('HEALTHCHECK');

    for (const composeFile of [developmentCompose, productionCompose]) {
      const apiService = composeFile
        .split('\n  api:\n')[1]
        ?.split('\n  web:\n')[0];

      expect(apiService).toContain('healthcheck:');
      expect(apiService).toContain(
        "test: ['CMD', 'node', '/app/apps/api/dist/healthcheck.js']",
      );
      expect(apiService).not.toContain('node -e');
      expect(apiService).not.toContain('fetch(');
    }
  });

  it('deploys only fast-forward main commits with successful CI and rollback', () => {
    for (const script of [
      autoDeployUrl,
      startStackUrl,
      stopStackUrl,
      installAutoDeployUrl,
    ]) {
      const syntax = spawnSync('/bin/sh', ['-n', fileURLToPath(script)]);
      expect(syntax.status).toBe(0);
    }
    expect(autoDeploy).toContain('git merge-base --is-ancestor');
    expect(autoDeploy).toContain('/actions/runs?');
    expect(autoDeploy).toContain('"$project_root/deploy/backup.sh"');
    expect(autoDeploy).toContain('git merge --ff-only');
    expect(autoDeploy).toContain('git reset --hard "$current_head"');
    expect(autoDeploy).toContain('BUILD_IMAGES=true');
    expect(autoDeploy).toContain('BUILD_IMAGES=false');
    expect(autoDeploy).toContain('[ "$previous_image_tag" = "$target_head" ]');
    expect(autoDeploy).not.toContain('up -d --build');
    expect(autoDeploy).toContain('"$project_root/deploy/verify.sh"');
    expect(startStack).toContain('build api web');
    expect(startStack).toContain('compose up -d db');
    expect(startStack).toContain('compose up -d --no-deps api');
    expect(startStack).toContain('compose up -d --no-deps web');
    expect(startStack).toContain('wait_for_healthy');
    expect(installAutoDeploy).toContain(
      'systemctl --user enable kanban-compose.service kanban-autodeploy.timer',
    );
    expect(composeService).toContain(
      'Environment=PODMAN_COMPOSE_PROVIDER=/usr/bin/podman-compose',
    );
    expect(composeService).toContain(
      'ExecStop=%h/apps/minimal-kanban/deploy/stop-stack.sh',
    );
    expect(autoDeployService).toContain('Requires=kanban-compose.service');
    expect(autoDeployService).toContain('TimeoutStartSec=7200');
    expect(autoDeployTimer).toContain('OnUnitActiveSec=5min');
  });

  it('starts the production stack in dependency order and waits for health', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kanban-start-stack-'));
    try {
      const envFile = join(directory, 'api.env');
      const fakePodman = join(directory, 'podman');
      const logFile = join(directory, 'podman.log');
      writeFileSync(envFile, 'IMAGE_TAG=test\n', { mode: 0o600 });
      writeFileSync(
        fakePodman,
        `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_PODMAN_LOG"
if [ "$1" = inspect ]; then
  printf 'healthy\\n'
  exit 0
fi
case "$*" in
  *" ps -q db") printf 'db-container\\n' ;;
  *" ps -q api") printf 'api-container\\n' ;;
  *" ps -q web") printf 'web-container\\n' ;;
esac
`,
        { mode: 0o700 },
      );
      chmodSync(fakePodman, 0o700);

      const result = spawnSync('/bin/sh', [fileURLToPath(startStackUrl)], {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTODEPLOY_STATE_DIR: join(directory, 'state'),
          BUILD_IMAGES: 'true',
          COMPOSE_COMMAND_TIMEOUT_SECONDS: '5',
          ENV_FILE: envFile,
          FAKE_PODMAN_LOG: logFile,
          HEALTH_POLL_INTERVAL_SECONDS: '0',
          HEALTH_TIMEOUT_SECONDS: '2',
          PODMAN: fakePodman,
        },
      });

      expect(result.status, result.stderr).toBe(0);
      const commands = readFileSync(logFile, 'utf8').trim().split('\n');
      const index = (suffix: string) =>
        commands.findIndex((command) => command.endsWith(suffix));
      expect(index('build api web')).toBeGreaterThan(-1);
      expect(index('up -d db')).toBeLessThan(index('up -d --no-deps api'));
      expect(index('up -d --no-deps api')).toBeLessThan(
        index('up -d --no-deps web'),
      );
      expect(commands).toContainEqual(expect.stringContaining('db-container'));
      expect(commands).toContainEqual(expect.stringContaining('api-container'));
      expect(commands).toContainEqual(expect.stringContaining('web-container'));
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('stops staged startup before web when the API is unhealthy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kanban-unhealthy-stack-'));
    try {
      const envFile = join(directory, 'api.env');
      const fakePodman = join(directory, 'podman');
      const logFile = join(directory, 'podman.log');
      writeFileSync(envFile, 'IMAGE_TAG=test\n', { mode: 0o600 });
      writeFileSync(
        fakePodman,
        `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_PODMAN_LOG"
if [ "$1" = inspect ]; then
  case "$*" in
    *api-container) printf 'unhealthy\\n' ;;
    *) printf 'healthy\\n' ;;
  esac
  exit 0
fi
case "$*" in
  *" ps -q db") printf 'db-container\\n' ;;
  *" ps -q api") printf 'api-container\\n' ;;
  *" ps -q web") printf 'web-container\\n' ;;
esac
`,
        { mode: 0o700 },
      );

      const result = spawnSync('/bin/sh', [fileURLToPath(startStackUrl)], {
        encoding: 'utf8',
        env: {
          ...process.env,
          AUTODEPLOY_STATE_DIR: join(directory, 'state'),
          BUILD_IMAGES: 'false',
          COMPOSE_COMMAND_TIMEOUT_SECONDS: '5',
          ENV_FILE: envFile,
          FAKE_PODMAN_LOG: logFile,
          HEALTH_POLL_INTERVAL_SECONDS: '0',
          HEALTH_TIMEOUT_SECONDS: '2',
          PODMAN: fakePodman,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('api entered terminal state: unhealthy');
      const commands = readFileSync(logFile, 'utf8').trim().split('\n');
      expect(commands).not.toContainEqual(
        expect.stringContaining('build api web'),
      );
      expect(commands).not.toContainEqual(
        expect.stringContaining('up -d --no-deps web'),
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('installs the user units without modifying the production env file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kanban-install-autodeploy-'));
    try {
      const project = join(directory, 'minimal-kanban');
      const unitSource = join(project, 'deploy', 'systemd');
      const bin = join(directory, 'bin');
      const envFile = join(directory, 'api.env');
      const unitTarget = join(directory, 'units');
      const stateDir = join(directory, 'state');
      const systemctlLog = join(directory, 'systemctl.log');
      const composeProvider = join(bin, 'podman-compose');
      mkdirSync(unitSource, { recursive: true });
      mkdirSync(bin, { recursive: true });
      for (const unit of [
        'kanban-compose.service',
        'kanban-autodeploy.service',
        'kanban-autodeploy.timer',
      ]) {
        writeFileSync(
          join(unitSource, unit),
          readFileSync(
            new URL(`../../../deploy/systemd/${unit}`, import.meta.url),
          ),
        );
      }
      writeFileSync(envFile, 'IMAGE_TAG=unchanged\n', { mode: 0o600 });
      writeFileSync(composeProvider, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      writeFileSync(
        join(bin, 'systemctl'),
        '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$FAKE_SYSTEMCTL_LOG"\nexit 0\n',
        { mode: 0o700 },
      );
      writeFileSync(join(bin, 'loginctl'), "#!/bin/sh\nprintf 'yes\\n'\n", {
        mode: 0o700,
      });
      expect(
        spawnSync('git', ['init', '-b', 'main'], { cwd: project }).status,
      ).toBe(0);
      writeFileSync(join(project, 'README.md'), 'test\n');
      expect(spawnSync('git', ['add', '.'], { cwd: project }).status).toBe(0);
      expect(
        spawnSync(
          'git',
          [
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.com',
            'commit',
            '-m',
            'fixture',
          ],
          { cwd: project },
        ).status,
      ).toBe(0);

      const result = spawnSync(
        '/bin/sh',
        [fileURLToPath(installAutoDeployUrl)],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            AUTODEPLOY_STATE_DIR: stateDir,
            ENV_FILE: envFile,
            EXPECTED_PROJECT_DIR: project,
            FAKE_SYSTEMCTL_LOG: systemctlLog,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            PODMAN_COMPOSE_PROVIDER: composeProvider,
            PROJECT_DIR: project,
            SYSTEMD_USER_DIR: unitTarget,
            USER: 'test-user',
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(envFile, 'utf8')).toBe('IMAGE_TAG=unchanged\n');
      expect(statSync(unitTarget).mode & 0o777).toBe(0o700);
      expect(statSync(stateDir).mode & 0o777).toBe(0o700);
      expect(readFileSync(systemctlLog, 'utf8')).toContain(
        '--user start kanban-autodeploy.service',
      );
      for (const unit of [
        'kanban-compose.service',
        'kanban-autodeploy.service',
        'kanban-autodeploy.timer',
      ]) {
        expect(readFileSync(join(unitTarget, unit), 'utf8')).toBeTruthy();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('keeps untrusted pull requests away from the production host', () => {
    expect(ciWorkflow).toContain('pull_request:');
    expect(ciWorkflow).toContain('branches: [main]');
    expect(ciWorkflow).toContain('permissions:\n  contents: read');
    expect(ciWorkflow).toContain('runs-on: ubuntu-latest');
    expect(ciWorkflow).not.toContain('self-hosted');
    expect(ciWorkflow).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/);
    expect(ciWorkflow).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
    expect(ciWorkflow).toContain('npm run verify');
    expect(ciWorkflow).toContain('npm run test:integration');
    expect(ciWorkflow).toContain('npm run test:e2e');
  });
});
