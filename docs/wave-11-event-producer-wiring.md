# Event Producer Wiring — SNS Publish Guide

> **Wave 11 — In-app Notifications**
>
> This document explains how service-level event producers publish notification
> events to the central SNS topic for processing by the Notification Lambda.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐     ┌────────────────┐
│ Feedback Engine │     │  Admin Service   │     │  Override Expiry   │     │ Other Producers│
│   (Python)      │     │  (Node/TS)       │     │  (EventBridge)     │     │                │
└───────┬─────────┘     └───────┬──────────┘     └────────┬───────────┘     └───────┬────────┘
        │                       │                         │                          │
        │  SNS Publish          │  SNS Publish            │ Internal (direct)        │
        ▼                       ▼                         ▼                          ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                          wren-notification-events (SNS Topic)                             │
└───────────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼  (SQS subscription with DLQ)
┌───────────────────────────────────────────┐
│        Notification Lambda (Node 22)      │
│   - Resolves recipients from app DB       │
│   - Deduplicates                          │
│   - Renders templates                     │
│   - Persists to PostgreSQL                │
│   - Publishes real-time via AppSync       │
└───────────────────────────────────────────┘
```

## NotificationEvent Schema

All producers **must** publish messages conforming to this JSON schema:

```json
{
  "typeSlug": "string — matches a notification_type.slug in the catalog",
  "entityId": "string — the entity that triggered this (draftId, overrideId, etc.)",
  "context": {
    "key": "value pairs for template interpolation"
  },
  "recipientUserId": "string (optional) — explicit single recipient",
  "departmentId": "string (optional) — for dept-scoped notifications",
  "documentTypeId": "string (optional) — for doc-type-scoped notifications"
}
```

### TypeScript type (from `@wren/notification`):

```typescript
import type { NotificationEvent } from '@wren/notification';
```

## SNS Publish Examples

### Node.js / TypeScript (Admin Service)

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const sns = new SNSClient({});
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN!;

export async function publishNotificationEvent(event: NotificationEvent): Promise<void> {
  await sns.send(new PublishCommand({
    TopicArn: NOTIFICATION_TOPIC_ARN,
    Message: JSON.stringify(event),
    MessageAttributes: {
      typeSlug: {
        DataType: 'String',
        StringValue: event.typeSlug,
      },
    },
  }));
}

// Example: override granted
await publishNotificationEvent({
  typeSlug: 'override-granted',
  entityId: overrideId,
  recipientUserId: studentUserId,
  context: {
    documentTypeName: 'Lab Report',
    grantedByName: 'Prof. Smith',
    expiresAt: '2026-09-01T00:00:00Z',
  },
});
```

### Python (Feedback Engine)

```python
import json
import boto3

sns = boto3.client('sns')
NOTIFICATION_TOPIC_ARN = os.environ['NOTIFICATION_TOPIC_ARN']

def publish_notification_event(event: dict) -> None:
    sns.publish(
        TopicArn=NOTIFICATION_TOPIC_ARN,
        Message=json.dumps(event),
        MessageAttributes={
            'typeSlug': {
                'DataType': 'String',
                'StringValue': event['typeSlug'],
            },
        },
    )

# Example: AI debrief ready
publish_notification_event({
    'typeSlug': 'ai-debrief-ready',
    'entityId': draft_id,
    'recipientUserId': student_user_id,
    'context': {
        'draftTitle': draft_title,
        'assignmentName': assignment_name,
    },
})
```

## Event Types & Their Producers

| typeSlug | Producer | recipientUserId | context keys |
|----------|----------|-----------------|--------------|
| `ai-debrief-ready` | Feedback Engine | student | `draftTitle`, `assignmentName` |
| `override-granted` | Admin Service | student | `documentTypeName`, `grantedByName`, `expiresAt` |
| `override-revoked` | Admin Service | student | `documentTypeName`, `revokedByName` |
| `override-expiring` | Override Expiry Handler (internal) | dept admin | `overrideId`, `studentName`, `documentTypeName` |
| `override-expired` | Override Expiry Handler (internal) | dept admin | `overrideId`, `studentName`, `documentTypeName` |
| `usage-limit-warning` | Usage Tracking | student | `documentTypeName`, `remaining`, `limit` |
| `usage-limit-reached` | Usage Tracking | student | `documentTypeName` |
| `system-announcement` | Admin Service | (broadcast) | `title`, `body` |

## Override Expiry Handler (Internal Producer)

The override expiry handler is unique — it runs **inside** the Notification Lambda
on an EventBridge schedule (every 15 minutes) and produces events internally
without going through SNS. It calls `checkOverrideExpiry()` which returns
`NotificationEvent[]` that are then passed directly to `notificationService.processEvent()`.

```typescript
// In the Lambda handler (EventBridge source detection):
import { checkOverrideExpiry } from '@wren/notification';

if (event.source === 'aws.events') {
  const events = await checkOverrideExpiry(db, {
    warningHours: 24,
    checkIntervalMinutes: 15,
  });
  for (const notifEvent of events) {
    await notificationService.processEvent(notifEvent);
  }
}
```

## SNS Topic Configuration

- **Topic Name**: `wren-notification-events`
- **Message filtering**: Optional filter on `typeSlug` attribute for future fan-out
- **DLQ**: Attached to the SQS subscription (3 retries before DLQ)
- **Encryption**: SSE-SQS (at rest), TLS (in transit)

## IAM Permissions

Each producer needs `sns:Publish` on the notification topic ARN:

```json
{
  "Effect": "Allow",
  "Action": "sns:Publish",
  "Resource": "arn:aws:sns:*:*:wren-notification-events"
}
```

## Testing Producer Integration

Use the AWS CLI to simulate a producer event:

```bash
aws sns publish \
  --topic-arn "$NOTIFICATION_TOPIC_ARN" \
  --message '{"typeSlug":"ai-debrief-ready","entityId":"draft-123","recipientUserId":"user-456","context":{"draftTitle":"My Essay","assignmentName":"Week 3 Paper"}}' \
  --message-attributes '{"typeSlug":{"DataType":"String","StringValue":"ai-debrief-ready"}}'
```
