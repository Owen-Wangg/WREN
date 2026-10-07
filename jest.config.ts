import type { Config } from 'jest';

/**
 * Root Jest configuration for WREN Writing Coach Node/TypeScript code
 * (CDK infrastructure + frontend logic). Uses ts-jest so tests can be
 * authored in TypeScript with the repo's strict compiler settings.
 *
 * Per-package configs (cdk/, frontend/) may extend or override this once
 * those packages are scaffolded; until then this discovers any `*.test.ts`
 * outside node_modules and the build output directories.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // The base tsconfig uses classic (Node10) resolution, which does not
        // read package.json "exports" subpaths. Add a compiler `paths` mapping
        // so ts-jest type-checks the @wren/admin subpath import used by
        // askWren.ts / lambda handlers (runtime resolution is handled by
        // moduleNameMapper below).
        tsconfig: {
          baseUrl: '.',
          paths: {
            '@wren/admin/lifetimeUsagePolicy': [
              './backend/admin/src/lifetimeUsagePolicy.ts',
            ],
            '@wren/types/signupEmailDomains': [
              './types/src/signupEmailDomains.ts',
            ],
          },
        },
      },
    ],
  },
  // Explicit test-only env (e.g. PROMPT_GUARDRAIL_SKIP for the admin guardrail).
  setupFiles: ['<rootDir>/testing/typescript/jest.setup.ts'],
  testMatch: ['<rootDir>/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/cdk.out/',
    '/dist/',
    '/cdk/',
    // Frontend tests use Vitest (not Jest) — they are run separately via `vite test`.
    'frontend/src/',
  ],
  modulePathIgnorePatterns: ['/node_modules/', '/cdk.out/', '/dist/'],
  // Map NodeNext-style ".js" relative imports onto their ".ts" sources.
  moduleNameMapper: {
    // Workspace package subpath exports Jest's resolver doesn't read from
    // package.json "exports". Map the @wren/admin subpath to its source so
    // tests importing modules that depend on it resolve without a build step.
    '^@wren/admin/lifetimeUsagePolicy$':
      '<rootDir>/backend/admin/src/lifetimeUsagePolicy.ts',
    '^@wren/types/signupEmailDomains$':
      '<rootDir>/types/src/signupEmailDomains.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  clearMocks: true,
};

export default config;
