import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

describe('OpenAPI Department visibility contracts', () => {
  const definition = load(
    readFileSync(path.join(__dirname, '..', 'lib', 'openapi.yaml'), 'utf8'),
  ) as {
    paths: Record<string, Record<string, any>>;
    components: { schemas: Record<string, any> };
  };

  it('defines the visibility state and permission CRUD routes', () => {
    expect(
      definition.paths['/v1/departments/{departmentId}/visibility-state']?.put
        ?.operationId,
    ).toBe('setDepartmentVisibilityState');
    expect(
      definition.paths['/v1/departments/{departmentId}/visibility-grants']?.get
        ?.operationId,
    ).toBe('listDepartmentVisibilityGrants');
    expect(
      definition.paths['/v1/departments/{departmentId}/visibility-grants']?.post
        ?.operationId,
    ).toBe('createDepartmentVisibilityGrant');
    expect(
      definition.paths['/v1/departments/{departmentId}/visibility-grants/{grantId}']
        ?.delete?.operationId,
    ).toBe('revokeDepartmentVisibilityGrant');
  });

  it('keeps visibility distinct from OPEN/LOCKED submission access', () => {
    expect(definition.components.schemas.Department.required).toEqual(
      expect.arrayContaining(['visibilityState', 'viewerCanDiscover']),
    );
    expect(
      definition.components.schemas.Department.properties.visibilityState.enum,
    ).toEqual(['VISIBLE', 'PERMITTED_ONLY']);
    expect(
      definition.components.schemas.Department.properties.accessState.enum,
    ).toEqual(['OPEN', 'LOCKED']);
  });

  it('returns typed Department and permission-list responses', () => {
    expect(
      definition.paths['/v1/departments']!.get!.responses['200'].content[
        'application/json'
      ].schema.items.$ref,
    ).toBe('#/components/schemas/Department');
    expect(
      definition.paths['/v1/departments/{departmentId}/visibility-grants']!.get!
        .responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/DepartmentVisibilityPermissionList');
    const listOperation =
      definition.paths['/v1/departments/{departmentId}/visibility-grants']!.get!;
    expect(listOperation.responses['400'].$ref).toBe(
      '#/components/responses/BadRequest',
    );
    expect(
      listOperation.parameters.find((parameter: { name: string }) =>
        parameter.name === 'limit',
      ).schema.maximum,
    ).toBe(100);
  });
});
