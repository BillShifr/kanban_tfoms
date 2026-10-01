import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfiles = [
  new URL('../Dockerfile', import.meta.url),
  new URL('../../web/Dockerfile', import.meta.url),
];

describe('container image references', () => {
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
});
