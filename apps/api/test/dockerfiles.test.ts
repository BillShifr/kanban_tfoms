import { readFileSync } from 'node:fs';
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

  it('keeps the API healthcheck in the image to avoid compose command rewriting', () => {
    expect(apiDockerfile).toContain(
      'CMD ["node", "apps/api/dist/healthcheck.js"]',
    );

    for (const composeFile of [developmentCompose, productionCompose]) {
      const apiService = composeFile
        .split('\n  api:\n')[1]
        ?.split('\n  web:\n')[0];

      expect(apiService).not.toContain('healthcheck:');
      expect(apiService).not.toContain('node -e');
      expect(apiService).not.toContain('fetch(');
    }
  });
});
