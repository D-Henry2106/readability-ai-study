import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseNameFromMongoUri } from '@/lib/db/mongodb-uri';
import { requireTestMongoUri } from '../helpers/test-mongo-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MongoDB database selection from URI', () => {
  it('extracts an explicit database for standard, SRV and replica-set URIs', () => {
    expect(databaseNameFromMongoUri('mongodb+srv://user:password@cluster.example.net/research_experiment_prod?retryWrites=true')).toBe('research_experiment_prod');
    expect(databaseNameFromMongoUri('mongodb://127.0.0.1:27017/research_experiment_test')).toBe('research_experiment_test');
    expect(databaseNameFromMongoUri('mongodb://db1.local:27017,db2.local:27017/study_dev?replicaSet=rs0')).toBe('study_dev');
  });

  it('rejects URIs without an explicit database', () => {
    for (const uri of ['mongodb://localhost:27017', 'mongodb://localhost:27017/', 'mongodb+srv://cluster.example.net/?retryWrites=true']) {
      expect(() => databaseNameFromMongoUri(uri)).toThrow('MONGODB_URI');
    }
  });

  it('rejects invalid database paths', () => {
    expect(() => databaseNameFromMongoUri('mongodb://localhost:27017/some%2Fdb')).toThrow('invalid database');
    expect(() => databaseNameFromMongoUri('mongodb://localhost:27017/%zz')).toThrow('invalid database');
  });

  it('allows destructive tests only with an explicit test database', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('MONGODB_URI', 'mongodb+srv://cluster.example.net/research_experiment_test');
    expect(requireTestMongoUri().databaseName).toBe('research_experiment_test');
    vi.stubEnv('MONGODB_URI', 'mongodb+srv://cluster.example.net/research_experiment_prod');
    expect(() => requireTestMongoUri()).toThrow('Refusing to run destructive tests');
    vi.stubEnv('MONGODB_URI', 'mongodb+srv://cluster.example.net/research_experiment_test_prod');
    expect(() => requireTestMongoUri()).toThrow('Refusing to run destructive tests');
  });
});
