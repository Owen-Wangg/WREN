"""DataAccess parameterization tests (Requirement 39.2).

A fake pool/connection/cursor records how ``execute`` is called so the test can
assert that values are passed as bind parameters (a separate argument) and never
interpolated into the SQL string.
"""
from __future__ import annotations

from typing import Any, List, Optional, Sequence, Tuple

from leon_db.client import DataAccess


class FakeCursor:
    def __init__(self, rows: List[Tuple[Any, ...]], has_results: bool) -> None:
        self._rows = rows
        self.description = object() if has_results else None
        self.rowcount = len(rows)
        self.calls: List[Tuple[str, Optional[Sequence[Any]]]] = []

    def execute(self, sql: str, params: Optional[Sequence[Any]] = None) -> None:
        self.calls.append((sql, params))

    def fetchall(self) -> List[Tuple[Any, ...]]:
        return self._rows

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def cursor(self) -> FakeCursor:
        return self._cursor

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakePool:
    def __init__(self, cursor: FakeCursor) -> None:
        self._conn = FakeConnection(cursor)

    def connection(self) -> FakeConnection:
        return self._conn


def test_query_passes_values_as_bind_parameters():
    rows = [("1", "a@example.com")]
    cursor = FakeCursor(rows, has_results=True)
    db = DataAccess(FakePool(cursor))

    email = "bobby'); DROP TABLE app_user; --"
    result = db.query("SELECT * FROM app_user WHERE email = %s", [email])

    assert result == rows
    sql, params = cursor.calls[0]
    # Injection payload lives in the params arg, not the SQL text → it is bound.
    assert sql == "SELECT * FROM app_user WHERE email = %s"
    assert "DROP TABLE" not in sql
    assert params == [email]


def test_query_returns_empty_when_no_result_set():
    cursor = FakeCursor([], has_results=False)
    db = DataAccess(FakePool(cursor))

    assert db.query("SET search_path TO public") == []


def test_execute_returns_affected_row_count():
    cursor = FakeCursor([], has_results=False)
    cursor.rowcount = 3
    db = DataAccess(FakePool(cursor))

    affected = db.execute(
        "UPDATE document SET status = %s WHERE id = %s",
        ["Polishing", "doc-1"],
    )

    assert affected == 3
    _, params = cursor.calls[0]
    assert params == ["Polishing", "doc-1"]
