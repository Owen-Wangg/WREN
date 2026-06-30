"""Forward-only migration runner tests (lexical order + idempotency)."""
from __future__ import annotations

from typing import Any, List, Optional, Sequence, Tuple

from leon_db.migrate import (
    DEFAULT_MIGRATIONS_DIR,
    list_migration_files,
    run_migrations,
)


def test_list_migration_files_real_lexical_order():
    files = list_migration_files(DEFAULT_MIGRATIONS_DIR)
    assert files == [
        "0001_enable_extensions.sql",
        "0002_initial_schema.sql",
    ]


def test_list_migration_files_is_sorted():
    files = list_migration_files(DEFAULT_MIGRATIONS_DIR)
    assert files == sorted(files)


class FakeCursor:
    def __init__(self, applied: List[str], calls: List[Tuple[str, Any]]) -> None:
        self._applied = applied
        self._calls = calls

    def execute(self, sql: str, params: Optional[Sequence[Any]] = None) -> None:
        self._calls.append((sql, params))

    def fetchall(self) -> List[Tuple[str, ...]]:
        return [(name,) for name in self._applied]

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakeTransaction:
    def __init__(self, counter: List[int]) -> None:
        self._counter = counter

    def __enter__(self) -> "FakeTransaction":
        self._counter[0] += 1
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakeConnection:
    def __init__(self, applied: List[str]) -> None:
        self.applied = applied
        self.calls: List[Tuple[str, Any]] = []
        self.transaction_count = [0]

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.applied, self.calls)

    def transaction(self) -> FakeTransaction:
        return FakeTransaction(self.transaction_count)

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakePool:
    def __init__(self, applied: List[str]) -> None:
        self.conn = FakeConnection(applied)

    def connection(self) -> FakeConnection:
        return self.conn


def test_applies_all_migrations_on_fresh_database():
    pool = FakePool([])

    applied = run_migrations(pool)

    assert applied == [
        "0001_enable_extensions.sql",
        "0002_initial_schema.sql",
    ]
    assert pool.conn.transaction_count[0] == 2


def test_skips_already_applied_migrations():
    pool = FakePool(["0001_enable_extensions.sql"])

    applied = run_migrations(pool)

    assert applied == ["0002_initial_schema.sql"]
    assert pool.conn.transaction_count[0] == 1


def test_no_op_when_database_is_current():
    pool = FakePool(
        ["0001_enable_extensions.sql", "0002_initial_schema.sql"]
    )

    applied = run_migrations(pool)

    assert applied == []
    assert pool.conn.transaction_count[0] == 0


def test_records_each_migration_with_parameterized_insert():
    pool = FakePool([])

    run_migrations(pool)

    inserts = [
        (sql, params)
        for sql, params in pool.conn.calls
        if "INSERT INTO schema_migrations" in sql
    ]
    assert len(inserts) == 2
    for sql, params in inserts:
        assert "VALUES (%s)" in sql
        assert isinstance(params, tuple)
        assert len(params) == 1
