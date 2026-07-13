"""
Placeholder handler — replaced by bundled service code at build time.
This file exists so CDK's Code.fromAsset can locate the asset directory.
"""


def handler(event, context):
    return {
        "statusCode": 501,
        "body": '{"code": "NOT_IMPLEMENTED", "message": "Handler not yet wired."}',
    }
