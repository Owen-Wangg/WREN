"""Parameterized PostgreSQL data-access layer for LEON Writing Coach Python 3.12 Lambdas.

Connects to RDS PostgreSQL 16 through RDS Proxy with TLS enforced (``sslmode=require``),
resolves credentials from Secrets Manager at runtime, pools connections via
``psycopg_pool``, and runs forward-only migrations. Packaged as a Lambda layer.

Only parameterized queries are exposed to application code: values are passed to
``psycopg`` as bind parameters and never interpolated into SQL strings
(Requirement 39.2 / UBC CIC security steering).
"""
from .client import DataAccess
from .config import DatabaseCredentials, connection_kwargs
from .migrate import (
    DEFAULT_MIGRATIONS_DIR,
    list_migration_files,
    run_migrations,
)
from .secrets import resolve_database_credentials

__all__ = [
    "DataAccess",
    "DatabaseCredentials",
    "connection_kwargs",
    "resolve_database_credentials",
    "list_migration_files",
    "run_migrations",
    "DEFAULT_MIGRATIONS_DIR",
]
