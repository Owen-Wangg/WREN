# Deployment Fixes — WREN Infrastructure

Summary of all issues encountered and fixes applied during the initial CDK deployment of the WREN Writing Coach infrastructure.

---

## 1. Missing npm dependency (`@aws-cdk/aws-amplify-alpha`)

**Error:** `Cannot find module '@aws-cdk/aws-amplify-alpha'`

**Cause:** Package was listed in `cdk/package.json` but not installed in `node_modules`.

**Fix:** Run `npm install` in the `cdk/` directory.

**File:** N/A (just a missing install)

---

## 2. PostgreSQL version not available in ca-central-1

**Error:** `Cannot find version 16.8 for postgres`

**Cause:** `PostgresEngineVersion.VER_16_8` doesn't exist in the `ca-central-1` region. CDK 2.260.0 supports up to `VER_16_13`.

**Fix:** Changed both occurrences in `cdk/lib/constructs/DatabaseResources.ts` from `VER_16_8` to `VER_16_13`.

**File:** `cdk/lib/constructs/DatabaseResources.ts`

---

## 3. Migration Lambda — `Cannot find module '@wren/db-node'`

**Error:** `Cannot find module '@wren/db-node'` at Lambda runtime

**Cause:** The `MigrationRunner` construct listed `@wren/db-node` in `externalModules`, telling esbuild to skip it during bundling. At runtime, the package wasn't available (no Lambda Layer).

**Fix:** Removed `externalModules: ['@wren/db-node']` from the bundling config so the package is bundled into the Lambda deployment artifact.

**File:** `cdk/lib/constructs/MigrationRunner.ts`

---

## 4. Migration Lambda — connecting to localhost instead of RDS Proxy

**Error:** `connect ECONNREFUSED 127.0.0.1:5432`

**Cause:** The migration handler called `createSql()` without arguments (a low-level function expecting connection options). It defaulted to `localhost:5432` instead of reading `DB_PROXY_HOST` from environment variables.

**Fix:** Rewrote `cdk/lambda/migrations/handler.ts` to use `resolveDatabaseCredentials` + `buildConnectionOptions` with environment variables (`DB_PROXY_HOST`, `DB_SECRET_ARN`).

**File:** `cdk/lambda/migrations/handler.ts`

---

## 5. Migration Lambda — ECONNRESET (proxy target group race condition)

**Error:** `read ECONNRESET`

**Cause:** The migration custom resource was created in parallel with the `DBProxyTargetGroup`. The proxy accepted connections but had no registered backend to route them to, causing connection resets.

**Fix:** Added an explicit dependency so the migration waits for the proxy target group:
```typescript
const proxyTargetGroup = this.database.proxy.node.findChild("ProxyTargetGroup");
this.migrations.node.addDependency(proxyTargetGroup);
```

**File:** `cdk/lib/stacks/DatabaseStack.ts`

---

## 6. Migration Lambda — SQL files not included in bundle

**Error:** `ENOENT: no such file or directory, scandir '/migrations'`

**Cause:** The `@wren/db-node` `runMigrations` function defaults to reading `.sql` files from a relative directory that doesn't exist inside the Lambda deployment package.

**Fix:**
1. Added `commandHooks.afterBundling` to copy `backend/database/migrations/` into the Lambda bundle (with Windows/Linux cross-platform support using `xcopy`/`cp`).
2. Added `MIGRATIONS_DIR: '/var/task/migrations'` environment variable.
3. Updated handler to pass `process.env.MIGRATIONS_DIR` to `runMigrations()`.

**Files:** `cdk/lib/constructs/MigrationRunner.ts`, `cdk/lambda/migrations/handler.ts`

---

## 7. Migration 0004 — `ON CONFLICT (name)` without unique constraint

**Error:** `there is no unique or exclusion constraint matching the ON CONFLICT specification`

**Cause:** Migration 0004 used `ON CONFLICT (name) DO NOTHING` on the `department` table, but `name` has no UNIQUE constraint (only `id` is the PK).

**Fix:** Simplified to a single deterministic-ID insert using `ON CONFLICT (id) DO NOTHING`.

**File:** `backend/database/migrations/0004_seed_reference_data.sql`

---

## 8. Migration 0006 — wrong table name and duplicate column

**Error:** Would have failed with `relation "writing_type_config" does not exist` and `column "type_prompt_text" already exists`

**Cause:** Migration 0006 referenced the pre-rename table name (`writing_type_config`) and tried to add a column (`type_prompt_text`) that already existed from migration 0003's rename.

**Fix:** Rewrote to use correct table name (`document_type_config`), removed the duplicate `ADD COLUMN type_prompt_text`, and added only the two new columns (`tone_description`, `density_description`) with `IF NOT EXISTS`.

**File:** `backend/database/migrations/0006_writing_type_config_prompts.sql`

---

## 9. Compute Stack — `externalModules` preventing Lambda bundling

**Error:** Would have caused `Cannot find module '@wren/auth'` at runtime (same as fix #3 but for all Compute Lambdas)

**Cause:** All Node.js Lambdas listed workspace packages as `externalModules`. esbuild skipped them, producing ~600-byte bundles with unresolved `require()` calls.

**Fix:** Removed all `externalModules` arrays. Changed `entry` paths to point directly at the source files (`backend/auth/src/authorizer.ts`, etc.) instead of through wrapper re-export files that used package-name imports. Added `nodePaths` pointing to the monorepo root `node_modules` for esbuild resolution.

**File:** `cdk/lib/stacks/ComputeStack.ts`

---

## 10. Compute Stack — esbuild not found from monorepo root

**Error:** `npx canceled due to missing packages: esbuild@0.28.1`

**Cause:** Setting `projectRoot` to the monorepo root caused CDK to run esbuild from there, but esbuild was only installed in `cdk/node_modules`.

**Fix:** Installed esbuild at the monorepo root (`npm install --save-dev esbuild@0.28.1` in root) and used `nodePaths` instead of `projectRoot` for module resolution.

**File:** Root `package.json`, `cdk/lib/stacks/ComputeStack.ts`

---

## 11. Compute Stack — ECR image `latest` not found

**Error:** `Source image wren-dev-feedback-engine:latest does not exist`

**Cause:** The Feedback Engine Lambda references an ECR image tagged `latest`, but no image had been pushed yet (the CICD pipeline hadn't run).

**Fix:** Pushed a placeholder Python Lambda base image manually:
```bash
docker pull public.ecr.aws/lambda/python:3.12
docker tag public.ecr.aws/lambda/python:3.12 877766546593.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine:latest
docker push 877766546593.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine:latest
```

**File:** N/A (manual one-time operation)

---

## 12. CICD Stack — empty IAM policy resources array

**Error:** `A PolicyStatement used in an identity-based policy must specify at least one resource`

**Cause:** A `PolicyStatement` for Secrets Manager access had `resources: []` (empty array), which CDK validation rejects.

**Fix:** Removed the dead-code policy statement entirely (CodeBuild doesn't need Secrets Manager access during normal builds).

**File:** `cdk/lib/stacks/CicdStack.ts`

---

## 13. CICD Pipeline — GitHub branch not found

**Error:** `[GitHub] No Branch [main] found for FullRepositoryName [UBC-CIC/WREN]`

**Cause:** The CodeConnections GitHub App installation on the `UBC-CIC` organization hadn't granted access to the `WREN` repository.

**Fix:** An org admin needs to go to GitHub → Organization Settings → Integrations → GitHub Apps → "AWS Connector for GitHub" → Configure → add `WREN` to repository access.

**File:** N/A (GitHub permissions configuration)

---

## 14. Api Stack — `Fn::Sub` intrinsic function error

**Error:** `One or more Fn::Sub intrinsic functions don't specify expected arguments`

**Cause:** The OpenAPI spec contained `Fn::Sub` intrinsics that became malformed after the `injectLambdaArns` function did string replacement within them. CloudFormation rejected the resulting template.

**Fix:** Replaced the string-injection approach with a `resolveSpec()` function that fully resolves all `Fn::Sub` intrinsics at synth time (replacing `${AWS::Region}` + all Lambda ARN placeholders), eliminating the need for CloudFormation to process them at deploy time.

**File:** `cdk/lib/stacks/ApiStack.ts`

---

## Deployment Order

```
1. Config          (SSM parameters)
2. Vpc             (network + endpoints)
3. Storage         (S3 buckets + DynamoDB)
4. Cognito         (user pool + client)
5. Database        (RDS + Proxy + migrations)
6. CICD            (ECR + Pipeline) — optional, needs CodeConnections
7. Compute         (all Lambdas) — needs ECR image
8. Api             (API Gateway from OpenAPI spec)
9. Observability   (CloudWatch + alarms)
10. CloudFrontWaf  (CDN + WAF, deploys to us-east-1)
11. Amplify        (frontend hosting) — needs GitHub PAT
```

## Prerequisites

- AWS CLI configured with appropriate profile
- CDK bootstrapped in both `ca-central-1` and `us-east-1`
- Docker running (for ECR image push + esbuild bundling)
- GitHub PAT stored in Secrets Manager at `/<stackPrefix>/github/token`
- CodeConnections connection created and authorized with GitHub org access
- esbuild installed at monorepo root
