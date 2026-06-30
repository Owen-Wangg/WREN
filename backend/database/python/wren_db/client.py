"""Parameterized data-access surface for Python Lambdas.

The only query entry points accept the SQL text and a separate sequence of bind
parameters. ``psycopg`` sends the parameters to PostgreSQL as bind parameters
(``%s`` placeholders) and never interpolates them into the SQL string, which
prevents SQL injection (Requirement 39.2 / UBC CIC security steering).
"""
from __future__ import annotations

from typing import Any, List, Optional, Sequence, Tuple


class DataAccess:
    """Thin parameterized wrapper around a ``psycopg_pool`` connection pool."""

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    def query(
        self,
        sql: str,
        params: Optional[Sequence[Any]] = None,
    ) -> List[Tuple[Any, ...]]:
        """Run a parameterized SELECT and return all rows.

        ``params`` are bound positionally as ``%s`` placeholders.

        Example::

            db.query("SELECT * FROM app_user WHERE email = %s", [user_email])
        """
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if cur.description is None:
                    return []
                return cur.fetchall()

    def execute(
        self,
        sql: str,
        params: Optional[Sequence[Any]] = None,
    ) -> int:
        """Run a parameterized statement and return the affected row count."""
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.rowcount
