"""
Publish a debriefReady notification to AppSync via IAM-signed HTTP.

Called by handler.py after all feedback_item rows are committed.  Errors are
non-fatal: the frontend's polling fallback (/feedback/status) remains in place
during the transition period so a failed publish never blocks a successful job.
"""
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

logger = logging.getLogger(__name__)

_APPSYNC_URL: str | None = os.environ.get("APPSYNC_URL")
_AWS_REGION: str = os.environ.get("AWS_REGION", "ca-central-1")

_MUTATION = """
mutation PublishDebriefReady($documentId: ID!, $draftId: String!, $itemCount: Int!) {
  publishDebriefReady(documentId: $documentId, draftId: $draftId, itemCount: $itemCount) {
    documentId
    draftId
    itemCount
  }
}
""".strip()


def publish_debrief_ready(document_id: str, draft_id: str, item_count: int) -> None:
    """Send a publishDebriefReady mutation to AppSync using SigV4/IAM auth.

    Silently skips when APPSYNC_URL is not set (local dev / unit tests).
    """
    if not _APPSYNC_URL:
        logger.debug("APPSYNC_URL not set — skipping publish_debrief_ready")
        return

    payload = json.dumps(
        {
            "query": _MUTATION,
            "variables": {
                "documentId": document_id,
                "draftId": draft_id,
                "itemCount": item_count,
            },
        }
    ).encode()

    session = boto3.session.Session()
    credentials = session.get_credentials().get_frozen_credentials()

    aws_request = AWSRequest(
        method="POST",
        url=_APPSYNC_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(credentials, "appsync", _AWS_REGION).add_auth(aws_request)

    http_request = urllib.request.Request(
        _APPSYNC_URL,
        data=payload,
        headers=dict(aws_request.headers),
        method="POST",
    )

    try:
        with urllib.request.urlopen(http_request, timeout=10) as response:
            body = json.loads(response.read())
            if "errors" in body:
                logger.warning(
                    "AppSync publishDebriefReady returned errors: %s", body["errors"]
                )
            else:
                logger.info(
                    "AppSync publishDebriefReady sent for document=%s draft=%s items=%d",
                    document_id,
                    draft_id,
                    item_count,
                )
    except urllib.error.URLError as exc:
        logger.warning(
            "AppSync publish failed (non-fatal, polling fallback active): %s", exc
        )
