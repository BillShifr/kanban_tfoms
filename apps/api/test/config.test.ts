import { describe, expect, it } from 'vitest';
import {
  assertBootstrapCredentials,
  loadRuntimeConfig,
} from '../src/config.js';

describe('runtime configuration', () => {
  it('uses safe local defaults outside production', () => {
    const config = loadRuntimeConfig({ NODE_ENV: 'test' });

    expect(config.sessionCookieSecure).toBe(false);
    expect(config.trustProxy).toBe(false);
    expect(config.allowedOrigins).toContain('http://127.0.0.1:5173');
  });

  it('uses HTTPS and secure cookies as the production default', () => {
    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://kanban.example.test',
      }),
    ).toThrow('Production HTTP requires ALLOW_INSECURE_HTTP=true');

    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://kanban.example.test',
        SESSION_COOKIE_SECURE: 'false',
      }),
    ).toThrow('SESSION_COOKIE_SECURE must be true for production HTTPS');

    const config = loadRuntimeConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://kanban.example.test',
    });
    expect(config.sessionCookieSecure).toBe(true);
    expect(config.allowInsecureHttp).toBe(false);
  });

  it('allows internal production HTTP only through an explicit opt-in', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'http://kanban.tfoms',
      ALLOW_INSECURE_HTTP: 'true',
      SESSION_COOKIE_SECURE: 'false',
    });

    expect(config.allowInsecureHttp).toBe(true);
    expect(config.sessionCookieSecure).toBe(false);

    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://kanban.tfoms',
        ALLOW_INSECURE_HTTP: 'true',
      }),
    ).toThrow('SESSION_COOKIE_SECURE must be false for production HTTP');

    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://kanban.tfoms,https://kanban.tfoms',
        ALLOW_INSECURE_HTTP: 'true',
        SESSION_COOKIE_SECURE: 'false',
      }),
    ).toThrow('APP_ORIGIN must not mix http and https');

    expect(() =>
      loadRuntimeConfig({
        NODE_ENV: 'production',
        APP_ORIGIN: 'http://kanban.tfoms',
        ALLOW_INSECURE_HTTP: 'yes',
        SESSION_COOKIE_SECURE: 'false',
      }),
    ).toThrow('ALLOW_INSECURE_HTTP must be either true or false');
  });

  it('accepts only explicit production bootstrap credentials', () => {
    expect(() => assertBootstrapCredentials({}, 0)).toThrow(
      'are required for an empty database',
    );
    expect(() =>
      assertBootstrapCredentials(
        {
          NODE_ENV: 'production',
          INITIAL_ADMIN_EMAIL: 'admin@example.com',
          INITIAL_ADMIN_PASSWORD: 'change-me-now',
        },
        0,
      ),
    ).toThrow('Default bootstrap credentials are forbidden');
    expect(() =>
      assertBootstrapCredentials(
        {
          NODE_ENV: 'production',
          INITIAL_ADMIN_EMAIL: 'owner@example.test',
          INITIAL_ADMIN_PASSWORD: 'too-short',
        },
        0,
      ),
    ).toThrow('at least 16 characters');
  });
});
