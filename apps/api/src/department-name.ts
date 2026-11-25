import { z } from 'zod';

export const departmentInput = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();

export function postgresErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string' && current.code)
      return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
}

export function departmentWriteError(error: unknown) {
  const code = postgresErrorCode(error);
  if (code === '23505')
    return { status: 409, code: 'DEPARTMENT_NAME_TAKEN' } as const;
  if (code === '23514')
    return { status: 400, code: 'VALIDATION_ERROR' } as const;
}
