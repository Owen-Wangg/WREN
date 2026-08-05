/**
 * Utility for publishing NotificationEvent messages to the notification SNS topic.
 *
 * Used by event producers (Feedback Engine, Admin Service, Usage Service) to
 * publish structured notification events. The topic ARN is read from the
 * NOTIFICATION_TOPIC_ARN environment variable (injected by CDK).
 */
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { NotificationEvent } from './types';

let snsClient: SNSClient | null = null;

function getSnsClient(): SNSClient {
  if (!snsClient) {
    snsClient = new SNSClient({ region: process.env.AWS_REGION ?? 'ca-central-1' });
  }
  return snsClient;
}

/**
 * Publish a NotificationEvent to the notification SNS topic.
 *
 * @param event - The structured notification event to publish.
 * @throws If NOTIFICATION_TOPIC_ARN is not configured or SNS publish fails.
 */
export async function publishNotificationEvent(event: NotificationEvent): Promise<void> {
  const topicArn = process.env.NOTIFICATION_TOPIC_ARN;
  if (!topicArn) {
    console.warn('NOTIFICATION_TOPIC_ARN not configured — skipping notification publish:', event.typeSlug);
    return;
  }

  const client = getSnsClient();
  await client.send(new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify(event),
    MessageAttributes: {
      typeSlug: {
        DataType: 'String',
        StringValue: event.typeSlug,
      },
    },
  }));
}
