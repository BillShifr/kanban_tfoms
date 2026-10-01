const defaultDevelopmentOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export type RuntimeConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  uploadDir: string;
  sessionCookieSecure: boolean;
  allowInsecureHttp: boolean;
  trustProxy: boolean;
  allowedOrigins: Set<string>;
};

function booleanValue(
  value: string | undefined,
  fallback: boolean,
  name: string,
) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const rawEnvironment = environment.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(rawEnvironment))
    throw new Error('NODE_ENV must be development, test, or production');

  const nodeEnv = rawEnvironment as RuntimeConfig['nodeEnv'],
    allowInsecureHttp = booleanValue(
      environment.ALLOW_INSECURE_HTTP,
      false,
      'ALLOW_INSECURE_HTTP',
    ),
    sessionCookieSecure = booleanValue(
      environment.SESSION_COOKIE_SECURE,
      nodeEnv === 'production',
      'SESSION_COOKIE_SECURE',
    ),
    trustProxy = booleanValue(
      environment.TRUST_PROXY,
      nodeEnv === 'production',
      'TRUST_PROXY',
    ),
    configuredOrigins = (environment.APP_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    allowedOrigins = new Set(
      configuredOrigins.length
        ? configuredOrigins
        : nodeEnv === 'production'
          ? []
          : defaultDevelopmentOrigins,
    ),
    port = Number(environment.PORT ?? '3001');

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535');
  if (nodeEnv === 'production' && allowedOrigins.size === 0)
    throw new Error('APP_ORIGIN is required in production');
  const protocols = new Set<string>();
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== '/')
      throw new Error('APP_ORIGIN must contain origins without paths');
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('APP_ORIGIN must use http or https');
    protocols.add(parsed.protocol);
  }
  if (nodeEnv === 'production') {
    if (protocols.size !== 1)
      throw new Error('APP_ORIGIN must not mix http and https in production');
    const protocol = [...protocols][0];
    if (protocol === 'http:') {
      if (!allowInsecureHttp)
        throw new Error('Production HTTP requires ALLOW_INSECURE_HTTP=true');
      if (sessionCookieSecure)
        throw new Error(
          'SESSION_COOKIE_SECURE must be false for production HTTP',
        );
    } else if (!sessionCookieSecure) {
      throw new Error(
        'SESSION_COOKIE_SECURE must be true for production HTTPS',
      );
    }
  }

  return {
    nodeEnv,
    host: environment.HOST ?? '127.0.0.1',
    port,
    uploadDir: environment.UPLOAD_DIR ?? '/app/data/uploads',
    sessionCookieSecure,
    allowInsecureHttp,
    trustProxy,
    allowedOrigins,
  };
}

export function assertBootstrapCredentials(
  environment: NodeJS.ProcessEnv,
  userCount: number,
) {
  const email = environment.INITIAL_ADMIN_EMAIL,
    password = environment.INITIAL_ADMIN_PASSWORD;

  if (userCount === 0 && (!email || !password))
    throw new Error(
      'INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required for an empty database',
    );
  if ((email && !password) || (!email && password))
    throw new Error(
      'INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be provided together',
    );
  if (!email || !password) return;
  if (environment.NODE_ENV === 'production') {
    if (email === 'admin@example.com' || password === 'change-me-now')
      throw new Error(
        'Default bootstrap credentials are forbidden in production',
      );
    if (password.length < 16)
      throw new Error(
        'INITIAL_ADMIN_PASSWORD must contain at least 16 characters in production',
      );
  }
}
