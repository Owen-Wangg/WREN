"""TLS-enforcement and option-mapping tests for the config module (Req 39.2)."""
import pytest

from leon_db.config import (
    REQUIRED_SSL_MODE,
    DatabaseCredentials,
    connection_kwargs,
)

CREDS = DatabaseCredentials(
    host="proxy.example.ca-central-1.rds.amazonaws.com",
    port=5432,
    username="leon_app",
    password="resolved-at-runtime",
    dbname="leon",
)


def test_sslmode_is_always_require():
    kwargs = connection_kwargs(CREDS)
    assert kwargs["sslmode"] == "require"
    assert REQUIRED_SSL_MODE == "require"


def test_maps_credentials_onto_connection_kwargs():
    kwargs = connection_kwargs(CREDS)
    assert kwargs["host"] == CREDS.host
    assert kwargs["port"] == CREDS.port
    assert kwargs["user"] == CREDS.username
    assert kwargs["password"] == CREDS.password
    assert kwargs["dbname"] == CREDS.dbname


def test_rejects_empty_host():
    with pytest.raises(ValueError, match="host"):
        connection_kwargs(DatabaseCredentials("", 5432, "u", "p", "leon"))


def test_rejects_invalid_port():
    with pytest.raises(ValueError, match="port"):
        connection_kwargs(DatabaseCredentials("h", 0, "u", "p", "leon"))
