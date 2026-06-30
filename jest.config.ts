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
  testMatch: ['<rootDir>/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/cdk.out/', '/dist/', '/cdk/'],
  modulePathIgnorePatterns: ['/node_modules/', '/cdk.out/', '/dist/'],
  clearMocks: true,
};

export default config;
