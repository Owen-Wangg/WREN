"""Connection configuration for the Python data-access layer.

Security invariants (Requirement 39.2 / UBC CIC security + DB steering):

* TLS to the database is MANDATORY. RDS Proxy is provisioned with
  ``rds.force_ssl`` (task 2.1), so every connection negotiates TLS. The
  connection kwargs always set ``sslmode='require'`` and there is no code path
  that disables it.
* Credentials are never hardcoded; they arrive as :class:`DatabaseCredentials`
  resolved from Secrets Manager at runtime (see :mod:`leon_db.secrets`).
* Connection pooling is provided by :mod:`leon_db.pool` so warm Lambda
  invocations reuse connections through RDS Proxy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

# TLS mode used for every connection. RDS Proxy rejects non-TLS connections
# (rds.force_ssl); this is intentionally a module-level constant.
REQUIRED_SSL_MODE = "require"


@dataclass(frozen=True)
class DatabaseCredentials:
    """Database credentials resolved from Secrets Manager (never hardcoded)."""

    host: str
    port: int
    username: str
    password: str
    dbname: str


def connection_kwargs(credentials: DatabaseCredentials) -> Dict[str, Any]:
    """Build ``psycopg`` connection kwargs with TLS always enforced.

    The returned mapping is passed to ``psycopg_pool.ConnectionPool`` /
    ``psycopg.connect``. ``sslmode`` is pinned to ``require`` so TLS can never
    be turned off through this layer.
    """
    if not credentials.host:
        raise ValueError("Database host is required to build connection kwargs.")
    if not isinstance(credentials.port, int) or credentials.port <= 0:
        raise ValueError(f"Invalid database port: {credentials.port!r}")

    return {
        "host": credentials.host,
        "port": credentials.port,
        "user": credentials.username,
        "password": credentials.password,
        "dbname": credentials.dbname,
        "sslmode": REQUIRED_SSL_MODE,
    }
