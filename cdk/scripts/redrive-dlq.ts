/**
 * Operator CLI: move messages from a WREN DLQ back to its source queue.
 *
 * Inspect the DLQ first. Do not run this as an automatic alarm action —
 * poison payloads will fail again and re-land on the DLQ.
 *
 * Usage (from cdk/):
 *   npx tsx scripts/redrive-dlq.ts notification
 *   npx tsx scripts/redrive-dlq.ts wren-dev-feedback-dlq
 */

import { parseDeploymentConfig } from "./operations/config.js";
import { AwsCli } from "./operations/awsCli.js";
import {
  resolveDlqRedriveTarget,
  sqsQueueArn,
  startMessageMoveTaskArgs,
} from "./operations/redriveDlq.js";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const input = argv[0];
  if (input === undefined || input === "--help" || input === "-h") {
    throw new Error(
      "Usage: npx tsx scripts/redrive-dlq.ts <notification|feedback|document-ingest|full-dlq-name>",
    );
  }

  const config = parseDeploymentConfig();
  const target = resolveDlqRedriveTarget(config.stackPrefix, input);
  const aws = new AwsCli(config.region);
  const identity = await aws.identity();
  const sourceArn = sqsQueueArn(config.region, identity.Account, target.dlqName);
  const destinationArn = sqsQueueArn(config.region, identity.Account, target.sourceQueueName);

  console.log(
    `[wren] Starting message move: ${target.dlqName} → ${target.sourceQueueName} in ${config.region}`,
  );
  const result = await aws.json<unknown>(startMessageMoveTaskArgs(sourceArn, destinationArn));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
