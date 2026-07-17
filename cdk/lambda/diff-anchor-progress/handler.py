"""
Diff / Anchor / Progress Lambda handler — pure logic, stdlib only.
Computes diff, remaps anchors, and tracks progress on feedback resolution.
"""

import json
import logging
from typing import Any

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    AWS Lambda handler for diff/anchor/progress logic.
    Receives HTTP proxy events and routes to handler functions.

    Routes:
      POST /v1/documents/{id}/diff → compute_diff
      POST /v1/documents/{id}/anchors/remap → remap_anchors
      POST /v1/documents/{id}/progress → compute_progress
    """
    try:
        resource = event.get('resource', '')
        http_method = event.get('httpMethod', '')
        path_params = event.get('pathParameters', {})

        logger.info(f"{http_method} {resource}")

        # Route dispatch
        if '/diff' in resource and http_method == 'POST':
            return handle_compute_diff(event)
        elif '/anchors/remap' in resource and http_method == 'POST':
            return handle_remap_anchors(event)
        elif '/progress' in resource and http_method == 'POST':
            return handle_compute_progress(event)
        else:
            return {
                "statusCode": 404,
                "body": json.dumps({"code": "NOT_FOUND", "message": "Route not found"}),
            }

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"code": "INTERNAL_ERROR", "message": "Failed to process request"}),
        }


def handle_compute_diff(event: dict[str, Any]) -> dict[str, Any]:
    """
    Compute diff between old and new segments.
    Request body: { "oldSegments": [...], "newSegments": [...] }
    """
    try:
        body = json.loads(event.get('body', '{}'))
        old_segments = body.get('oldSegments', [])
        new_segments = body.get('newSegments', [])

        # TODO: Import diff_engine from wren_engine and compute diff
        # diff_result = diff_engine.compute_diff(old_segments, new_segments)

        return {
            "statusCode": 200,
            "body": json.dumps({"diff": []}),
        }
    except Exception as e:
        logger.error(f"Error in compute_diff: {str(e)}", exc_info=True)
        return {
            "statusCode": 400,
            "body": json.dumps({"code": "BAD_REQUEST", "message": str(e)}),
        }


def handle_remap_anchors(event: dict[str, Any]) -> dict[str, Any]:
    """
    Remap anchors from old segments to new segments.
    Request body: { "oldSegments": [...], "newSegments": [...], "anchors": [...] }
    """
    try:
        body = json.loads(event.get('body', '{}'))
        old_segments = body.get('oldSegments', [])
        new_segments = body.get('newSegments', [])
        anchors = body.get('anchors', [])

        # TODO: Import anchor_service from wren_engine and remap anchors
        # remapped = anchor_service.remap_anchors(old_segments, new_segments, anchors)

        return {
            "statusCode": 200,
            "body": json.dumps({"remappedAnchors": []}),
        }
    except Exception as e:
        logger.error(f"Error in remap_anchors: {str(e)}", exc_info=True)
        return {
            "statusCode": 400,
            "body": json.dumps({"code": "BAD_REQUEST", "message": str(e)}),
        }


def handle_compute_progress(event: dict[str, Any]) -> dict[str, Any]:
    """
    Compute progress on feedback resolution.
    Request body: { "feedbackItems": [...], "resolutionHistory": [...] }
    """
    try:
        body = json.loads(event.get('body', '{}'))
        feedback_items = body.get('feedbackItems', [])
        resolution_history = body.get('resolutionHistory', [])

        # TODO: Import progress_tracker from wren_engine and compute progress
        # progress = progress_tracker.compute_progress(feedback_items, resolution_history)

        return {
            "statusCode": 200,
            "body": json.dumps({"progress": {"resolved": 0, "total": 0}}),
        }
    except Exception as e:
        logger.error(f"Error in compute_progress: {str(e)}", exc_info=True)
        return {
            "statusCode": 400,
            "body": json.dumps({"code": "BAD_REQUEST", "message": str(e)}),
        }
