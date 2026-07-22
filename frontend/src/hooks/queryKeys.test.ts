import { describe, expect, it } from 'vitest';

import { appConfig } from '@/config/env';

import { queryKeys } from './queryKeys';

describe('queryKeys', () => {
  it('namespaces every key with the deployment environment', () => {
    expect(queryKeys.documents()[0]).toBe(appConfig.environment);
    expect(queryKeys.writingTypes()[0]).toBe(appConfig.environment);
  });

  it('scopes document/debrief keys by writing-environment id', () => {
    expect(queryKeys.document('env-1')).toEqual([
      appConfig.environment,
      'documents',
      'env-1',
    ]);
    expect(queryKeys.debrief('env-1')).toEqual([
      appConfig.environment,
      'documents',
      'env-1',
      'debrief',
      'latest',
    ]);
    expect(queryKeys.debrief('env-1', 'draft-9')).toEqual([
      appConfig.environment,
      'documents',
      'env-1',
      'debrief',
      'draft-9',
    ]);
    expect(queryKeys.debriefHistory('env-1')).toEqual([
      appConfig.environment,
      'documents',
      'env-1',
      'debrief-history',
    ]);
  });

  it('produces distinct debrief keys per environment so regenerate invalidates one document only', () => {
    expect(queryKeys.debrief('env-1')).not.toEqual(queryKeys.debrief('env-2'));
  });
});
