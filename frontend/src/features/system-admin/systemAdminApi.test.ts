import {
  departmentSchema,
  departmentVisibilityGrantSchema,
  departmentVisibilityPermissionListSchema,
} from '@wren/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/services';
import {
  createDepartmentVisibilityGrant,
  listDepartmentVisibilityGrants,
  revokeDepartmentVisibilityGrant,
  setDepartmentVisibilityState,
} from './systemAdminApi';

describe('systemAdminApi department visibility methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates the visibility state through the department visibility endpoint', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({} as never);

    await setDepartmentVisibilityState('department-1', 'PERMITTED_ONLY');

    expect(request).toHaveBeenCalledWith(
      '/v1/departments/department-1/visibility-state',
      {
        method: 'PUT',
        body: { visibilityState: 'PERMITTED_ONLY' },
        schema: departmentSchema,
      },
    );
  });

  it('lists grants with encoded search and zero offset parameters', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({} as never);

    await listDepartmentVisibilityGrants('department-1', {
      q: 'name+email@example.com',
      limit: 25,
      offset: 0,
    });

    expect(request).toHaveBeenCalledWith(
      '/v1/departments/department-1/visibility-grants?q=name%2Bemail%40example.com&limit=25&offset=0',
      { schema: departmentVisibilityPermissionListSchema },
    );
  });

  it('creates an explicit grant for a user', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({} as never);

    await createDepartmentVisibilityGrant('department-1', 'user-1');

    expect(request).toHaveBeenCalledWith(
      '/v1/departments/department-1/visibility-grants',
      {
        method: 'POST',
        body: { userId: 'user-1' },
        schema: departmentVisibilityGrantSchema,
      },
    );
  });

  it('revokes by grant ID under the owning department', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({} as never);

    await revokeDepartmentVisibilityGrant('department-1', 'grant-1');

    expect(request).toHaveBeenCalledWith(
      '/v1/departments/department-1/visibility-grants/grant-1',
      { method: 'DELETE', schema: departmentVisibilityGrantSchema },
    );
  });
});
