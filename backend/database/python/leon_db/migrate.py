"""Programmatic, forward-only migration runner (Python).

Applies the ``.sql`` files in ``backend/database/migrations`` in lexical
filename order over the TLS-enforced RDS Proxy connection. Applied migrations
are tracked in a ``schema_migrations`` table so re-running is idempotent.
Each migration runs inside its own transaction and its filename is recorded with
a parameterized INSERT.

Migrations are trusted, version-controlled DDL (not user input). They are the
one place raw SQL files are executed; all application/user-derived input flows
through the parameterized :class:`leon_db.client.DataAccess` API instead.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, List

# Migration files look like ``0001_enable_extensions.sql``.
_MIGRATION_FILE_RE = re.compile(r"^\d+_.*\.sql$")

# Default location of the shared SQL migrations relative to this module:
# backend/database/python/leon_db/migrate.py -> backend/database/migrations.
DEFAULT_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"

_CREATE_TRACKING_TABLE = (
    "CREATE TABLE IF NOT EXISTS schema_migrations ("
    "filename text PRIMARY KEY, "
    "applied_at timestamptz NOT NULL DEFAULT now())"
)


def list_migration_files(migrations_dir: Any = DEFAULT_MIGRATIONS_DIR) -> List[str]:
    """Return migration filenames in lexical (forward-only) order.

    Numeric prefixes are zero-padded, so a plain string sort yields the correct
    application order.
    """
    directory = Path(migrations_dir)
    names = [
        entry.name
        for entry in directory.iterdir()
        if entry.is_file() and _MIGRATION_FILE_RE.match(entry.name)
    ]
    return sorted(names)


def run_migrations(
    pool: Any,
    migrations_dir: Any = DEFAULT_MIGRATIONS_DIR,
) -> List[str]:
    """Apply not-yet-applied migrations in lexical order.

    Returns the list of filenames applied during this run (empty if the
    database was already current).
    """
    directory = Path(migrations_dir)

    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(_CREATE_TRACKING_TABLE)
            cur.execute("SELECT filename FROM schema_migrations")
            applied = {row[0] for row in cur.fetchall()}

        newly_applied: List[str] = []
        for filename in list_migration_files(directory):
            if filename in applied:
                continue
            ddl = (directory / filename).read_text(encoding="utf-8")
            # One transaction per migration: the DDL and the bookkeeping insert
            # either both commit or both roll back.
            with conn.transaction():
                with conn.cursor() as cur:
                    cur.execute(ddl)
                    cur.execute(
                        "INSERT INTO schema_migrations (filename) VALUES (%s)",
                        (filename,),
                    )
            newly_applied.append(filename)

    return newly_applied
