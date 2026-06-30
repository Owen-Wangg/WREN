"""Pooled ``psycopg`` connection factory with a per-execution-environment cache.

Warm Lambda invocations reuse the pool (and thus connections through RDS Proxy).
``psycopg`` / ``psycopg_pool`` are imported lazily so the pure-logic modules
(config, migrate, client) can be imported and unit-tested without the native
driver installed.
"""
from __future__ import annotations

import os
from typing import Any, Mapping, Optional

from .config import DatabaseCredentials, connection_kwargs
from .secrets import resolve_database_credentials

_cached_pool: Optional[Any] = None


def create_pool(
    credentials: DatabaseCredentials,
    *,
    min_size: int = 1,
    max_size: int = 5,
) -> Any:
    """Create a ``psycopg_pool.ConnectionPool`` with TLS enforced."""
    from psycopg_pool import ConnectionPool  # Lazy: native dep.

    return ConnectionPool(
        kwargs=connection_kwargs(credentials),
        min_size=min_size,
        max_size=max_size,
        open=True,
    )


def get_pool(env: Optional[Mapping[str, str]] = None) -> Any:
    """Resolve credentials from Secrets Manager and return a cached pool.

    Required env var: ``DB_SECRET_ARN``. Optional non-secret RDS Proxy endpoint
    overrides: ``DB_PROXY_HOST``, ``DB_PORT``, ``DB_NAME``.
    """
    global _cached_pool
    if _cached_pool is not None:
        return _cached_pool

    env = env if env is not None else os.environ
    secret_id = env.get("DB_SECRET_ARN")
    if not secret_id:
        raise ValueError("DB_SECRET_ARN environment variable is required.")

    raw_port = env.get("DB_PORT")
    credentials = resolve_database_credentials(
        secret_id,
        host=env.get("DB_PROXY_HOST"),
        port=int(raw_port) if raw_port else None,
        dbname=env.get("DB_NAME"),
    )

    _cached_pool = create_pool(credentials)
    return _cached_pool


def reset_pool() -> None:
    """Close and clear the cached pool (primarily for tests/shutdown)."""
    global _cached_pool
    if _cached_pool is not None:
        _cached_pool.close()
        _cached_pool = None
