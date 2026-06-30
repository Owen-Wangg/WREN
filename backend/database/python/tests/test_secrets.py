"""Secrets Manager resolution tests (no hardcoded credentials)."""
from __future__ import annotations

import json
from typing import Any, Dict

import pytest

from leon_db.secrets import resolve_database_credentials


class FakeSecretsClient:
    def __init__(self, secret_string: Any) -> None:
        self._secret_string = secret_string
        self.requested_id: Any = None

    def get_secret_value(self, SecretId: str) -> Dict[str, Any]:  # noqa: N803
        self.requested_id = SecretId
        return {"SecretString": self._secret_string}


FULL_SECRET = json.dumps(
    {
        "host": "db.internal",
        "port": 5432,
        "username": "leon_app",
        "password": "super-secret",
        "dbname": "leon",
    }
)


def test_reads_and_parses_credentials_from_secrets_manager():
    client = FakeSecretsClient(FULL_SECRET)

    creds = resolve_database_credentials("arn:secret", client=client)

    assert client.requested_id == "arn:secret"
    assert creds.host == "db.internal"
    assert creds.port == 5432
    assert creds.username == "leon_app"
    assert creds.password == "super-secret"
    assert creds.dbname == "leon"


def test_overrides_supply_rds_proxy_endpoint():
    only_auth = json.dumps({"username": "leon_app", "password": "super-secret"})
    client = FakeSecretsClient(only_auth)

    creds = resolve_database_credentials(
        "arn:secret",
        client=client,
        host="proxy.rds",
        port=5432,
        dbname="leon",
    )

    assert creds.host == "proxy.rds"
    assert creds.dbname == "leon"
    assert creds.port == 5432


def test_coerces_string_port():
    string_port = json.dumps(
        {
            "host": "db.internal",
            "port": "5432",
            "username": "u",
            "password": "p",
            "dbname": "leon",
        }
    )
    creds = resolve_database_credentials(
        "arn:secret", client=FakeSecretsClient(string_port)
    )
    assert creds.port == 5432


def test_requires_secret_id():
    with pytest.raises(ValueError, match="required"):
        resolve_database_credentials("", client=FakeSecretsClient(FULL_SECRET))


def test_requires_username_and_password():
    client = FakeSecretsClient(json.dumps({"host": "h", "dbname": "d", "port": 1}))
    with pytest.raises(ValueError, match="username/password"):
        resolve_database_credentials("arn:secret", client=client)


def test_rejects_empty_secret_string():
    with pytest.raises(ValueError, match="SecretString"):
        resolve_database_credentials("arn:secret", client=FakeSecretsClient(None))
