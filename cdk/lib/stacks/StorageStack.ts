import { Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { ssmParameterNames, type AppConfig } from "../config.js";
import { StorageResources } from "../constructs/StorageResources.js";

export interface StorageStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * `${StackPrefix}-Storage` — object + key-value persistence.
 *
 * Instantiates {@link StorageResources} (encrypted, SSL-enforced,
 * block-public-access S3 buckets with lifecycle rules + the
 * `${StackPrefix}-ConversationHistory` DynamoDB table) and publishes their
 * names to SSM for downstream stacks.
 */
export class StorageStack extends Stack {
  public readonly storage: StorageResources;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.storage = new StorageResources(this, "Storage", {
      config: props.config,
    });

    new StringParameter(this, "DocumentsBucketNameParameter", {
      parameterName: ssmParameterNames.documentsBucketName(props.config),
      stringValue: this.storage.documentsBucket.bucketName,
      description: "Name of the S3 bucket holding submitted document bytes.",
    });

    new StringParameter(this, "ReferenceBucketNameParameter", {
      parameterName: ssmParameterNames.referenceBucketName(props.config),
      stringValue: this.storage.referenceBucket.bucketName,
      description: "Name of the S3 bucket holding Reference Material bytes.",
    });

    new StringParameter(this, "ConversationTableNameParameter", {
      parameterName: ssmParameterNames.conversationTableName(props.config),
      stringValue: this.storage.conversationTable.tableName,
      description: "Name of the DynamoDB conversation/session-state table.",
    });
  }
}
