import { Stack, type StackProps, RemovalPolicy, SecretValue, CfnCapabilities } from "aws-cdk-lib";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipelineActions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { AppConfig } from "../config";

/**
 * Props for the CICD stack.
 */
export interface CicdStackProps extends StackProps {
  readonly config: AppConfig;
  /** GitHub repository owner. */
  readonly repositoryOwner: string;
  /** GitHub repository name. */
  readonly repositoryName: string;
  /** Branch to deploy from. */
  readonly branch: string;
}

/**
 * `${StackPrefix}-CICD` — CodePipeline + CodeBuild + ECR.
 *
 * Pipeline stages:
 *   1. Source       — pull from GitHub via PAT webhook
 *   2. Build        — run tests, build + push container image to ECR (tagged with commit SHA),
 *                     and synth CDK for infra changes
 *   3. UpdateLambda — `lambda update-function-code` with the new image URI; fast path that
 *                     bypasses CloudFormation for pure code changes
 *   4. Deploy       — `cdk deploy` only for infra changes; runs every push but is a no-op
 *                     when only application code changed
 *
 * Separating UpdateLambda from Deploy means a Python-only commit takes seconds
 * (Lambda image swap) rather than minutes (full CloudFormation diff).
 */
export class CicdStack extends Stack {
  public readonly ecrRepository: ecr.Repository;
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const { config } = props;

    const functionName = `${config.stackPrefix}-feedback-engine`;

    // -------------------------------------------------------------------
    // ECR Repository (Feedback Engine container image)
    // -------------------------------------------------------------------
    this.ecrRepository = new ecr.Repository(this, "FeedbackEngineRepo", {
      repositoryName: `${config.stackPrefix}-feedback-engine`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: "Keep last 10 images",
          maxImageCount: 10,
          rulePriority: 1,
        },
      ],
    });

    // -------------------------------------------------------------------
    // Stage 2: Build — test, build + push image, synth CDK
    // -------------------------------------------------------------------
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: `${config.stackPrefix}-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": { nodejs: "22" },
            commands: [
              "npm ci",
              "cd cdk && npm ci && cd ..",
            ],
          },
          pre_build: {
            commands: [
              "npx tsc --noEmit",
              // ECR login before build so the push step is ready
              `aws ecr get-login-password --region ${config.env.region} | docker login --username AWS --password-stdin ${this.ecrRepository.repositoryUri}`,
            ],
          },
          build: {
            commands: [
              `docker build -t ${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION backend/engine/python/`,
              `docker push ${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION`,
              // Also keep bootstrap tag current so CloudFormation can always reference it
              `docker tag ${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION ${this.ecrRepository.repositoryUri}:bootstrap`,
              `docker push ${this.ecrRepository.repositoryUri}:bootstrap`,
              `echo "${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION" > image-uri.txt`,
              // Synth with the same stackPrefix/environment as this pipeline so
              // cdk.out/${stackPrefix}-Compute.assets.json actually exists
              // (cdk.json defaults to environmentName=dev otherwise).
              `cd cdk && npx cdk synth -c environmentName=${config.environmentName} -c projectName=${config.projectName} -c stackPrefix=${config.stackPrefix} -c githubOwner=${props.repositoryOwner} -c githubRepo=${props.repositoryName} -c githubBranch=${props.branch} && npx cdk-assets publish --path cdk.out/${config.stackPrefix}-Compute.assets.json && cd ..`,
            ],
          },
        },
        artifacts: {
          "secondary-artifacts": {
            CdkOutput: {
              "base-directory": "cdk/cdk.out",
              files: ["**/*"],
            },
            ImageUri: {
              files: ["image-uri.txt"],
            },
          },
        },
      }),
    });

    this.ecrRepository.grantPullPush(buildProject);

    // Allow cdk-assets publish to upload Lambda bundles to the CDK bootstrap bucket
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:GetBucketLocation'],
      resources: [
        `arn:aws:s3:::cdk-*-assets-${this.account}-${config.env.region}`,
        `arn:aws:s3:::cdk-*-assets-${this.account}-${config.env.region}/*`,
      ],
    }));

    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-*-file-publishing-role-${this.account}-${config.env.region}`],
    }));

    // Allow the Lambda service to pull images from this repo so
    // update-function-code and cold starts can access the image.
    this.ecrRepository.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
      actions: [
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'ecr:BatchCheckLayerAvailability',
      ],
    }));

    // -------------------------------------------------------------------
    // Stage 3: UpdateLambda — swap the image without touching CloudFormation
    // -------------------------------------------------------------------
    const updateLambdaProject = new codebuild.PipelineProject(this, "UpdateLambdaProject", {
      projectName: `${config.stackPrefix}-update-lambda`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          build: {
            commands: [
              "IMAGE_URI=$(cat image-uri.txt)",
              `aws lambda update-function-code --function-name ${functionName} --image-uri $IMAGE_URI`,
              // Wait for the update to finish before the pipeline proceeds
              `aws lambda wait function-updated --function-name ${functionName}`,
            ],
          },
        },
      }),
    });

    updateLambdaProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"],
      resources: [`arn:aws:lambda:${config.env.region}:*:function:${functionName}`],
    }));

    updateLambdaProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));

    this.ecrRepository.grantPull(updateLambdaProject);

    // -------------------------------------------------------------------
    // CodePipeline
    // -------------------------------------------------------------------
    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const cdkOutput = new codepipeline.Artifact("CdkOutput");
    const imageUriOutput = new codepipeline.Artifact("ImageUri");

    this.pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `${config.stackPrefix}-pipeline`,
      restartExecutionOnUpdate: true,
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipelineActions.GitHubSourceAction({
              actionName: "GitHub_Source",
              owner: props.repositoryOwner,
              repo: props.repositoryName,
              branch: props.branch,
              oauthToken: SecretValue.secretsManager(`${config.stackPrefix}/cicd/github-pat`),
              output: sourceOutput,
              trigger: codepipelineActions.GitHubTrigger.WEBHOOK,
            }),
          ],
        },
        {
          stageName: "Build",
          actions: [
            new codepipelineActions.CodeBuildAction({
              actionName: "Build_And_Test",
              project: buildProject,
              input: sourceOutput,
              outputs: [cdkOutput, imageUriOutput],
            }),
          ],
        },
        {
          stageName: "Deploy",
          actions: [
            new codepipelineActions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_CDK",
              stackName: `${config.stackPrefix}-Compute`,
              templatePath: cdkOutput.atPath(`${config.stackPrefix}-Compute.template.json`),
              adminPermissions: true,
              cfnCapabilities: [
                CfnCapabilities.NAMED_IAM,
                CfnCapabilities.AUTO_EXPAND,
              ],
            }),
          ],
        },
        {
          stageName: "UpdateLambda",
          actions: [
            new codepipelineActions.CodeBuildAction({
              actionName: "Update_Feedback_Engine",
              project: updateLambdaProject,
              input: imageUriOutput,
            }),
          ],
        },
      ],
    });
  }
}
