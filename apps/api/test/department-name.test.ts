import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import {
  departmentInput,
  departmentWriteError,
  postgresErrorCode,
} from '../src/department-name.js';

const productionName = 'Отдел организации и проведения';

describe('department name input', () => {
  it('accepts a valid Russian department name', () => {
    expect(departmentInput.parse({ name: productionName })).toEqual({
      name: productionName,
    });
  });

  it('trims surrounding spaces', () => {
    expect(departmentInput.parse({ name: `  ${productionName}  ` })).toEqual({
      name: productionName,
    });
  });

  it('rejects an empty name', () => {
    expect(departmentInput.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('department write errors', () => {
  it('maps a unique violation to a 409 even when Drizzle wraps it', () => {
    const wrapped = new DrizzleQueryError(
      'insert',
      [],
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    expect(postgresErrorCode(wrapped)).toBe('23505');
    expect(departmentWriteError(wrapped)).toEqual({
      status: 409,
      code: 'DEPARTMENT_NAME_TAKEN',
    });
  });

  it('maps a check constraint violation to a 400', () => {
    expect(departmentWriteError({ code: '23514' })).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('leaves unrelated errors unmapped', () => {
    expect(departmentWriteError(new Error('boom'))).toBeUndefined();
  });
});
