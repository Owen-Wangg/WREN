import { Stack, type StackProps, RemovalPolicy } from "aws-cdk-lib";
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
  /** GitHub connection ARN (CodeStar Connections). */
  readonly connectionArn: string;
}

/**
 * `${StackPrefix}-CICD` — CodePipeline + CodeBuild + ECR.
 *
 * - ECR repository for the Feedback Engine container image, with
 *   `imageScanOnPush: true` for vulnerability scanning.
 * - CodePipeline with Source → Build → Deploy stages.
 * - CodeBuild project that runs tests, builds the container image, and
 *   synthesizes CDK for deployment.
 * - Image tag immutability enabled on ECR to prevent overwriting.
 *
 * The pipeline is self-mutating (CDK Pipelines pattern) — changes to the
 * pipeline definition are applied on the next pipeline run.
 */
export class CicdStack extends Stack {
  public readonly ecrRepository: ecr.Repository;
  public readonly pipeline: codepipeline.Pipeline;

  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -------------------------------------------------------------------
    // ECR Repository (Feedback Engine container image)
    // -------------------------------------------------------------------
    this.ecrRepository = new ecr.Repository(this, "FeedbackEngineRepo", {
      repositoryName: `${config.stackPrefix}-feedback-engine`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
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
    // CodeBuild Project — test, build container, synth CDK
    // -------------------------------------------------------------------
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: `${config.stackPrefix}-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        privileged: true, // Required for Docker builds
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": {
              nodejs: "22",
              python: "3.12",
            },
            commands: [
              "npm ci",
              "cd cdk && npm ci && cd ..",
              "pip install uv && uv sync",
            ],
          },
          pre_build: {
            commands: [
              // Run TypeScript tests
              "npx jest --config jest.config.ts --passWithNoTests --ci",
              // Run Python tests
              "uv run pytest -m 'not integration and not slow' --tb=short",
              // Lint / type check
              "npx tsc --noEmit",
            ],
          },
          build: {
            commands: [
              // Build the Feedback Engine container image
              `docker build -t ${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION backend/engine/python/`,
              // Login to ECR and push
              `aws ecr get-login-password --region ${config.env.region} | docker login --username AWS --password-stdin ${this.ecrRepository.repositoryUri}`,
              `docker push ${this.ecrRepository.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION`,
              // CDK synth
              "cd cdk && npx cdk synth",
            ],
          },
        },
        artifacts: {
          "base-directory": "cdk/cdk.out",
          files: ["**/*"],
        },
      }),
    });

    // Grant CodeBuild permission to push to ECR.
    this.ecrRepository.grantPullPush(buildProject);

    // Grant CodeBuild permission to read Secrets Manager (for DB tests if needed).
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: ["*"], // Scoped further in production
    }));

    // -------------------------------------------------------------------
    // CodePipeline
    // -------------------------------------------------------------------
    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const buildOutput = new codepipeline.Artifact("BuildOutput");

    this.pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: `${config.stackPrefix}-pipeline`,
      restartExecutionOnUpdate: true,
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipelineActions.CodeStarConnectionsSourceAction({
              actionName: "GitHub_Source",
              owner: props.repositoryOwner,
              repo: props.repositoryName,
              branch: props.branch,
              connectionArn: props.connectionArn,
              output: sourceOutput,
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
              outputs: [buildOutput],
            }),
          ],
        },
        {
          stageName: "Deploy",
          actions: [
            new codepipelineActions.CloudFormationCreateUpdateStackAction({
              actionName: "Deploy_CDK",
              stackName: `${config.stackPrefix}-Compute`,
              templatePath: buildOutput.atPath(`${config.stackPrefix}-Compute.template.json`),
              adminPermissions: true, // CDK deploy needs broad permissions
            }),
          ],
        },
      ],
    });
  }
}
