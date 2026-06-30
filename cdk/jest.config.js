/**
 * Jest configuration for the LEON Writing Coach CDK package.
 *
 * The CDK sources are authored as NodeNext ESM and import sibling modules with
 * explicit `.js` extensions (e.g. `import { ... } from "../config.js"`). Under
 * Jest we transpile each file to CommonJS with ts-jest (`isolatedModules`) and
 * remap those `.js` specifiers back to their TypeScript sources at resolution
 * time, so the same source compiles for both `cdk synth` and the test runner.
 *
 * Per the CDK steering, stack behaviour is verified with snapshot tests and the
 * security/residency posture with fine-grained `aws-cdk-lib/assertions`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  // Map NodeNext-style ".js" relative imports onto their ".ts" sources.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "Node",
          target: "ES2022",
          esModuleInterop: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          isolatedModules: true,
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
};
