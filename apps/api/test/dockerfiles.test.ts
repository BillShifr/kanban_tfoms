import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
    const syntax = spawnSync('/bin/sh', ['-n', fileURLToPath(autoDeployUrl)]);
    expect(syntax.status).toBe(0);
    expect(autoDeploy).toContain('git merge-base --is-ancestor');
    expect(autoDeploy).toContain('/actions/runs?');
    expect(autoDeploy).toContain('"$project_root/deploy/backup.sh"');
    expect(autoDeploy).toContain('git merge --ff-only');
    expect(autoDeploy).toContain('git reset --hard "$current_head"');
    expect(autoDeploy).toContain('"$project_root/deploy/verify.sh"');
    expect(autoDeployTimer).toContain('OnUnitActiveSec=5min');
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
