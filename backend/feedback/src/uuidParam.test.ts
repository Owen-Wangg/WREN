import { parseUuidParam } from './uuidParam';

describe('parseUuidParam', () => {
  it('returns null for the debrief "none" sentinel', () => {
    expect(parseUuidParam('none')).toBeNull();
    expect(parseUuidParam('NONE')).toBeNull();
  });

  it('returns null for empty or non-string values', () => {
    expect(parseUuidParam('')).toBeNull();
    expect(parseUuidParam('   ')).toBeNull();
    expect(parseUuidParam(undefined)).toBeNull();
    expect(parseUuidParam(null)).toBeNull();
  });

  it('returns null for non-uuid strings', () => {
    expect(parseUuidParam('draft-1')).toBeNull();
    expect(parseUuidParam('not-a-uuid')).toBeNull();
  });

  it('accepts a canonical uuid', () => {
    const id = '536a86c8-953a-4749-8ecf-e359951d6f92';
    expect(parseUuidParam(id)).toBe(id);
    expect(parseUuidParam(` ${id} `)).toBe(id);
  });

  it('accepts the nil uuid postgres allows', () => {
    expect(parseUuidParam('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
  });
});
