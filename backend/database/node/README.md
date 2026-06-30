# `@leon/db-node` — Node data-access layer

Parameterized PostgreSQL data access for LEON Writing Coach **Node 22** Lambdas.
Built on the [`postgres`](https://github.com/porsager/postgres) driver. Connects
to RDS PostgreSQL 16 through **RDS Proxy with TLS enforced**, resolves
credentials from **Secrets Manager** at runtime, pools connections, and runs
forward-only migrations.

## Security guarantees (Requirement 39.2)

- **Parameterized queries only.** `DataAccess.query` / `DataAccess.execute` take
  the SQL text and a separate array of bind parameters (`$1..$N`). Values are
  never interpolated into SQL, preventing injection.
- **TLS is mandatory.** `buildConnectionOptions` pins `ssl: 'require'`; there is
  no code path that disables it (RDS Proxy enforces `rds.force_ssl`).
- **No hardcoded credentials.** Credentials are fetched from Secrets Manager via
  `resolveDatabaseCredentials` using only the `DB_SECRET_ARN` config.
- **Connection pooling.** A per-execution-environment cached pool (`getDataAccess`)
  lets warm Lambda invocations reuse connections.

## Usage

```ts
import { getDataAccess, runMigrations } from '@leon/db-node';

const db = await getDataAccess(); // reads DB_SECRET_ARN, DB_PROXY_HOST, DB_PORT, DB_NAME
const users = await db.query(
  'SELECT id, email FROM app_user WHERE email = $1',
  [email],
);
```

Run migrations programmatically (lexical filename order, idempotent):

```ts
import postgres from 'postgres';
import { buildConnectionOptions, resolveDatabaseCredentials, runMigrations } from '@leon/db-node';

const creds = await resolveDatabaseCredentials(process.env.DB_SECRET_ARN!);
const sql = postgres(buildConnectionOptions(creds));
const applied = await runMigrations(sql); // applies backend/database/migrations/*.sql
```

### Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `DB_SECRET_ARN` | yes | Secrets Manager id/arn holding DB credentials |
| `DB_PROXY_HOST` | no | RDS Proxy endpoint host (non-secret override) |
| `DB_PORT` | no | DB port override |
| `DB_NAME` | no | Database name override |

## Lambda layer packaging

Bundle `src/` (compiled) plus `node_modules/postgres` and the AWS SDK under the
layer's `nodejs/` directory, and include `backend/database/migrations/*.sql` so
`runMigrations` can find them (or pass an explicit `migrationsDir`).

## Test

```bash
npx jest backend/database/node   # from the repo root
npm run typecheck                # from this directory
```
