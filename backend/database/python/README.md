# `wren_db` — Python data-access layer

Parameterized PostgreSQL data access for WREN Writing Coach **Python 3.12**
Lambdas. Built on [`psycopg[binary,pool]`](https://www.psycopg.org/psycopg3/).
Connects to RDS PostgreSQL 16 through **RDS Proxy with TLS enforced**, resolves
credentials from **Secrets Manager** at runtime, pools connections, and runs
forward-only migrations.

## Security guarantees (Requirement 39.2)

- **Parameterized queries only.** `DataAccess.query` / `DataAccess.execute` take
  the SQL text and a separate sequence of bind parameters (`%s`). Values are
  never interpolated into SQL, preventing injection.
- **TLS is mandatory.** `connection_kwargs` pins `sslmode='require'`; there is no
  code path that disables it (RDS Proxy enforces `rds.force_ssl`).
- **No hardcoded credentials.** Credentials are fetched from Secrets Manager via
  `resolve_database_credentials` using only the `DB_SECRET_ARN` config.
- **Connection pooling.** A per-execution-environment cached `psycopg_pool`
  (`get_pool`) lets warm Lambda invocations reuse connections.

## Usage

```python
from wren_db import DataAccess
from wren_db.pool import get_pool

db = DataAccess(get_pool())  # reads DB_SECRET_ARN, DB_PROXY_HOST, DB_PORT, DB_NAME
rows = db.query("SELECT id, email FROM app_user WHERE email = %s", [email])
```

Run migrations programmatically (lexical filename order, idempotent):

```python
from wren_db.migrate import run_migrations
from wren_db.pool import get_pool

applied = run_migrations(get_pool())  # applies backend/database/migrations/*.sql
```

### Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `DB_SECRET_ARN` | yes | Secrets Manager id/arn holding DB credentials |
| `DB_PROXY_HOST` | no | RDS Proxy endpoint host (non-secret override) |
| `DB_PORT` | no | DB port override |
| `DB_NAME` | no | Database name override |

## Lambda layer packaging

`requirements.txt` is the pinned runtime dependency set (compiled with
`uv pip compile requirements.in -o requirements.txt`). `boto3` is intentionally
omitted — it is provided by the Lambda Python runtime. Install into the layer's
`python/` directory and include `backend/database/migrations/*.sql`.

## Test

```bash
uv run pytest backend/database/python -q   # from the repo root
```
