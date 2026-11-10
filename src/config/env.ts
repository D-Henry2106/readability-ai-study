import { z } from 'zod';
import { databaseNameFromMongoUri } from '@/lib/db/mongodb-uri';

const mongoEnvSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required')
});

const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must contain at least 32 characters')
});

const appEnvSchema = z.object({
  APP_URL: z.string().url().default('http://localhost:3000')
});

const securityEnvSchema = z.object({
  /** Set to "true" only behind a proxy that overwrites X-Forwarded-For (e.g. Vercel). Otherwise client IPs are unknown. */
  TRUST_PROXY_HEADERS: z.enum(['true', 'false']).default('false'),
  ADMIN_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  ADMIN_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(24).default(8)
});

function parseEnv<T>(schema: z.ZodType<T>, label: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid ${label} environment configuration: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.data;
}

export function getMongoEnv() {
  const env = parseEnv(mongoEnvSchema, 'MongoDB');
  databaseNameFromMongoUri(env.MONGODB_URI);
  return env;
}

export function getAuthEnv() {
  return parseEnv(authEnvSchema, 'authentication');
}

export function getAppEnv() {
  return parseEnv(appEnvSchema, 'application');
}

export function getSecurityEnv() {
  return parseEnv(securityEnvSchema, 'security');
}

export function getEnv() {
  return {
    ...getMongoEnv(),
    ...getAuthEnv(),
    ...getAppEnv()
  };
}
