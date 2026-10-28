import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('dotenv', () => ({ config: vi.fn() }));
import { runtimeDatabaseUrl } from '../src/env';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@primary.example.invalid/app');
  vi.stubEnv('DATABASE_URL_TEST', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('database test isolation without database access', () => {
  it('refuses to fall through to the application database in a test process', () => {
    expect(() => runtimeDatabaseUrl()).toThrow('DATABASE_URL_TEST is required');
  });
  it('rejects the same database even with different credentials or URL options', () => {
    vi.stubEnv('DATABASE_URL_TEST', 'postgresql://another:credential@primary.example.invalid/app?sslmode=require');
    expect(() => runtimeDatabaseUrl()).toThrow('separate test database');
  });
  it('rejects the pooled and direct URLs of the same Neon branch', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@branch-pooler.example.invalid/app');
    vi.stubEnv('DATABASE_URL_TEST', 'postgresql://fixture:fixture@branch.example.invalid/app');
    expect(() => runtimeDatabaseUrl()).toThrow('separate test database');
  });
  it('uses an explicitly separate database in test mode', () => {
    vi.stubEnv('DATABASE_URL_TEST', 'postgresql://fixture:fixture@test.example.invalid/app');
    expect(runtimeDatabaseUrl()).toBe('postgresql://fixture:fixture@test.example.invalid/app');
  });
  it('preserves application database selection outside test mode', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(runtimeDatabaseUrl()).toBe('postgresql://fixture:fixture@primary.example.invalid/app');
  });
});
