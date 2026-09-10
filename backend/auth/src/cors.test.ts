import {
  AMPLIFY_APP_ORIGIN_PATTERN,
  bindCorsOrigin,
  corsResponseHeaders,
  parseCorsAllowlist,
  resolveAllowedOrigin,
  withCorsHeaders,
} from './cors';

describe('CORS origin allowlist', () => {
  const env = {
    CORS_ALLOWED_ORIGINS: 'https://coach.example.com,https://www.coach.example.com',
    CORS_ALLOW_AMPLIFY_ORIGINS: 'true',
  };

  it('always includes local Vite origins even when the env list is empty', () => {
    expect(parseCorsAllowlist({ CORS_ALLOWED_ORIGINS: '' })).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('echoes an exact allowlisted origin and local Vite', () => {
    expect(resolveAllowedOrigin('https://coach.example.com', env)).toBe(
      'https://coach.example.com',
    );
    expect(resolveAllowedOrigin('http://localhost:5173', env)).toBe('http://localhost:5173');
  });

  it('echoes Amplify default hosts and rejects lookalikes', () => {
    const amplify = 'https://main.d1234567890.amplifyapp.com';
    expect(AMPLIFY_APP_ORIGIN_PATTERN.test(amplify)).toBe(true);
    expect(resolveAllowedOrigin(amplify, env)).toBe(amplify);
    expect(resolveAllowedOrigin('https://evil.amplifyapp.com.attacker.test', env)).toBeUndefined();
    expect(resolveAllowedOrigin('http://main.d1234567890.amplifyapp.com', env)).toBeUndefined();
  });

  it('omits Access-Control-Allow-Origin when the request origin is not allowed', () => {
    expect(resolveAllowedOrigin('https://evil.example', env)).toBeUndefined();
    expect(corsResponseHeaders('https://evil.example', env)['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('can disable Amplify hosts via CORS_ALLOW_AMPLIFY_ORIGINS=false', () => {
    expect(
      resolveAllowedOrigin('https://main.d123.amplifyapp.com', {
        ...env,
        CORS_ALLOW_AMPLIFY_ORIGINS: 'false',
      }),
    ).toBeUndefined();
  });

  it('bindCorsOrigin + withCorsHeaders reflect the request Origin', () => {
    bindCorsOrigin({ headers: { origin: 'http://localhost:5173' } });
    const result = withCorsHeaders({ statusCode: 200, body: '{}' });
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(result.headers?.['Vary']).toBe('Origin');
  });
});
