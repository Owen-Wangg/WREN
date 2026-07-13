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

  get documentsBucketName(): string {
    return this.storage.documentsBucket.bucketName;
  }

  get referenceBucketName(): string {
    return this.storage.referenceBucket.bucketName;
  }

  get conversationTableName(): string {
    return this.storage.conversationTable.tableName;
  }

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.storage = new StorageResources(this, "Storage", {
      config: props.config,
    });

    new StringParameter(this, "DocumentsBucketNameParameter", {
      parameterName: ssmParameterNames.documentsBucketName(props.config),
      stringValue: this.documentsBucketName,
      description: "Name of the S3 bucket holding submitted document bytes.",
    });

    new StringParameter(this, "ReferenceBucketNameParameter", {
      parameterName: ssmParameterNames.referenceBucketName(props.config),
      stringValue: this.referenceBucketName,
      description: "Name of the S3 bucket holding Reference Material bytes.",
    });

    new StringParameter(this, "ConversationTableNameParameter", {
      parameterName: ssmParameterNames.conversationTableName(props.config),
      stringValue: this.conversationTableName,
      description: "Name of the DynamoDB conversation/session-state table.",
    });
  }
}
