import { describe, it, expect } from 'vitest';
import { deriveWorkerMongoUri, isTestDatabaseName, MAX_DATABASE_NAME_LENGTH, withDatabaseName, workerDatabaseName } from '../helpers/test-db-name';
import { databaseNameFromMongoUri } from '@/lib/db/mongodb-uri';

describe('per-worker test database names (P0)', () => {
  it('always still end in _test, so the destructive-test guard keeps protecting real databases', () => {
    const name = workerDatabaseName('crp_local_test', 'a1b2c3', '4');
    expect(name).toBe('crp_local_a1b2c3_w4_test');
    expect(isTestDatabaseName(name)).toBe(true);
  });
  it('differs by worker and by run, and is stable for the same inputs', () => {
    const names = new Set([['a1b2c3', '1'], ['a1b2c3', '2'], ['d4e5f6', '1']].map(([r, w]) => workerDatabaseName('crp_test', r, w)));
    expect(names.size).toBe(3);
    expect(workerDatabaseName('crp_test', 'a1b2c3', '1')).toBe(workerDatabaseName('crp_test', 'a1b2c3', '1'));
  });
  it('never exceeds the Atlas database-name limit, however long the base name is', () => {
    const name = workerDatabaseName(`${'x'.repeat(60)}_test`, 'a1b2c3', '12');
    expect(name.length).toBeLessThanOrEqual(MAX_DATABASE_NAME_LENGTH);
    expect(name.endsWith('_w12_test')).toBe(true);
  });
  it('refuses a base database that is not a test database', () => {
    expect(() => workerDatabaseName('research_production', 'a1b2c3', '1')).toThrow(/Refusing/);
    expect(deriveWorkerMongoUri('mongodb://h/readability', 'a1b2c3', '1')).toBeNull();
    expect(deriveWorkerMongoUri('mongodb://h/', 'a1b2c3', '1')).toBeNull();
  });
  it('rejects ids that could smuggle path or operator characters', () => {
    for (const run of ['', 'AB', 'a.b', 'a$b', '../x']) expect(() => workerDatabaseName('t_test', run, '1')).toThrow();
    for (const worker of ['', 'x', '1.2', '1000']) expect(() => workerDatabaseName('t_test', 'a1b2c3', worker)).toThrow();
  });
  it('changes only the database in the URI; host, credentials and options are untouched', () => {
    const base = 'mongodb+srv://user:p%40ss@cluster0.example.mongodb.net/crp_test?retryWrites=true&w=majority&appName=x';
    const derived = deriveWorkerMongoUri(base, 'a1b2c3', '2')!;
    expect(derived).toBe('mongodb+srv://user:p%40ss@cluster0.example.mongodb.net/crp_a1b2c3_w2_test?retryWrites=true&w=majority&appName=x');
    expect(databaseNameFromMongoUri(derived)).toBe('crp_a1b2c3_w2_test');
    expect(withDatabaseName('mongodb://a:1,b:2/x_test?replicaSet=rs0', 'y_test')).toBe('mongodb://a:1,b:2/y_test?replicaSet=rs0');
  });
  it('always derives from the base, so re-running setup in the same process never stacks suffixes', () => {
    const base = 'mongodb://h/crp_test';
    const once = deriveWorkerMongoUri(base, 'a1b2c3', '1')!;
    expect(deriveWorkerMongoUri(base, 'a1b2c3', '1')).toBe(once);
  });
});
