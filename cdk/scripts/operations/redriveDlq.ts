/**
 * Map a stack-prefixed DLQ name (or a short suffix) to its source queue.
 *
 * Used by the operator redrive CLI. Auto-redrive is intentionally not wired
 * to CloudWatch alarms — poison messages must be inspected first.
 */

export const DLQ_SOURCE_BY_SUFFIX = {
  "notification-dlq": "notification-queue",
  "feedback-dlq": "feedback-queue",
  "document-ingest-dlq": "document-ingest-queue",
} as const;

export type DlqSuffix = keyof typeof DLQ_SOURCE_BY_SUFFIX;

export interface DlqRedriveTarget {
  readonly dlqName: string;
  readonly sourceQueueName: string;
}

export function resolveDlqRedriveTarget(
  stackPrefix: string,
  input: string,
): DlqRedriveTarget {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("DLQ name is required.");
  }
  const prefix = `${stackPrefix}-`;
  let suffix = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  if (!suffix.endsWith("-dlq")) {
    suffix = `${suffix}-dlq`;
  }
  const sourceSuffix = DLQ_SOURCE_BY_SUFFIX[suffix as DlqSuffix];
  if (sourceSuffix === undefined) {
    throw new Error(
      `Unknown DLQ '${input}'. Expected one of: ${Object.keys(DLQ_SOURCE_BY_SUFFIX).join(", ")} ` +
        `(optionally prefixed with ${prefix}).`,
    );
  }
  return {
    dlqName: `${prefix}${suffix}`,
    sourceQueueName: `${prefix}${sourceSuffix}`,
  };
}

export function sqsQueueArn(region: string, account: string, queueName: string): string {
  return `arn:aws:sqs:${region}:${account}:${queueName}`;
}

export function startMessageMoveTaskArgs(
  sourceArn: string,
  destinationArn: string,
): readonly string[] {
  return [
    "sqs",
    "start-message-move-task",
    "--source-arn",
    sourceArn,
    "--destination-arn",
    destinationArn,
  ];
}
