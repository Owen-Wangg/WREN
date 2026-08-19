"""Runtime resolution of database credentials from AWS Secrets Manager.

Credentials are NEVER hardcoded or read from plaintext env vars. The Lambda
receives only the secret id/arn (``DB_SECRET_ARN``) and, optionally, the RDS
Proxy endpoint details as non-secret config. The actual username/password are
fetched from Secrets Manager at runtime (UBC CIC security steering).
"""
from __future__ import annotations

import json
from typing import Any, Optional

from .config import DatabaseCredentials


def resolve_database_credentials(
    secret_id: str,
    *,
    client: Optional[Any] = None,
    host: Optional[str] = None,
    port: Optional[int] = None,
    dbname: Optional[str] = None,
) -> DatabaseCredentials:
    """Fetch and parse database credentials from Secrets Manager.

    ``host``/``port``/``dbname`` overrides (non-secret RDS Proxy endpoint
    config) take precedence over values embedded in the secret. ``client`` is
    injectable so tests need no live AWS calls; in production a boto3
    Secrets Manager client is created lazily.
    """
    if not secret_id:
        raise ValueError("A Secrets Manager secret id/arn is required.")

    if client is None:
        import boto3  # Lazy import: boto3 is provided by the Lambda runtime.

        client = boto3.client("secretsmanager")

    response = client.get_secret_value(SecretId=secret_id)
    raw_value = response.get("SecretString")
    if not raw_value:
        raise ValueError("Secret value is empty or binary; expected SecretString.")

    try:
        data = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise ValueError("Secret is not valid JSON.") from exc

    username = data.get("username")
    password = data.get("password")
    if not username or not password:
        raise ValueError("Secret is missing required username/password fields.")

    resolved_host = host or data.get("host")
    if not resolved_host:
        raise ValueError("Database host is not present in the secret or overrides.")

    # Per-role secrets are username+password only (RDS Proxy).
    resolved_dbname = dbname or data.get("dbname") or data.get("database") or "appdb"

    raw_port = port if port is not None else data.get("port")
    if raw_port is None:
        raw_port = 5432
    try:
        resolved_port = int(raw_port)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid database port: {raw_port!r}") from exc

    return DatabaseCredentials(
        host=resolved_host,
        port=resolved_port,
        username=username,
        password=password,
        dbname=resolved_dbname,
    )
