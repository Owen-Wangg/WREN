import {
  resolveDlqRedriveTarget,
  sqsQueueArn,
  startMessageMoveTaskArgs,
} from "../scripts/operations/redriveDlq.js";

describe("resolveDlqRedriveTarget", () => {
  it("maps short suffixes and full queue names to the source queue", () => {
    expect(resolveDlqRedriveTarget("wren-dev", "notification")).toEqual({
      dlqName: "wren-dev-notification-dlq",
      sourceQueueName: "wren-dev-notification-queue",
    });
    expect(resolveDlqRedriveTarget("wren-dev", "wren-dev-feedback-dlq")).toEqual({
      dlqName: "wren-dev-feedback-dlq",
      sourceQueueName: "wren-dev-feedback-queue",
    });
    expect(resolveDlqRedriveTarget("wren-dev", "document-ingest-dlq")).toEqual({
      dlqName: "wren-dev-document-ingest-dlq",
      sourceQueueName: "wren-dev-document-ingest-queue",
    });
  });

  it("rejects an unknown DLQ", () => {
    expect(() => resolveDlqRedriveTarget("wren-dev", "other-dlq")).toThrow(/Unknown DLQ/);
  });
});

describe("SQS redrive command", () => {
  it("builds start-message-move-task against the source queue ARN", () => {
    const source = sqsQueueArn("ca-central-1", "123456789012", "wren-dev-notification-dlq");
    const dest = sqsQueueArn("ca-central-1", "123456789012", "wren-dev-notification-queue");
    expect(startMessageMoveTaskArgs(source, dest)).toEqual([
      "sqs",
      "start-message-move-task",
      "--source-arn",
      source,
      "--destination-arn",
      dest,
    ]);
  });
});
