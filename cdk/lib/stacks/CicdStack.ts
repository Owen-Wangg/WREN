import { Stack, type StackProps, RemovalPolicy, SecretValue, CfnCapabilities, Duration } from "aws-cdk-lib";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipelineActions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { bedrockModelIdParameterName, ssmParameterNames, type AppConfig } from "../config";

/**
 * Service-function name suffixes the `${prefix}-Compute` stack creates
 * (ComputeStack.ts). Single source of truth for the Lambda ARNs the Compute
 * deploy role may mutate and invoke.
 *
 * These functions are named `${prefix}-<suffix>`, NOT `${prefix}-Compute-*`, so
 * they are enumerated here rather than matched by a prefix wildcard. A prefix
 * wildcard (`${prefix}-*`) would also match the Database stack's `${prefix}-migrate`
 * and `${prefix}-sync-db-passwords` functions, which hold database credentials and
 * must stay outside the Compute deploy role's reach.
 *
 * Adding a new Compute function here is required: omit it and its deploy
 * surfaces an `AccessDenied` in the CloudFormation stack events — add the
 * suffix, never widen back to `"*"`.
 */
const COMPUTE_FUNCTION_SUFFIXES = [
  "authorizer",
  "document",
  "admin",
  "sync-cognito-admins",
  "feedback-orchestrator",
  "feedback-engine",
  "diff-anchor-progress",
  "notification",
  "appsync-authorizer",
] as const;

/**
 * Props for the CICD stack.
 */
export interface CicdStackProps extends StackProps {
  readonly config: AppConfig;
  /** Whether this stack owns the ECR repository or imports a legacy/manual repository. */
  readonly ecrOwnership?: "managed" | "external";
  /** Create CodePipeline resources only when explicitly enabled. */
  readonly enablePipeline?: boolean;
  /** GitHub repository owner; required when enablePipeline is true. */
  readonly repositoryOwner?: string;
  /** GitHub repository name; required when enablePipeline is true. */
  readonly repositoryName?: string;
  /** Branch to deploy from; required when enablePipeline is true. */
  readonly branch?: string;
}

/**
 * Synth-time ARN literals the Compute deploy policy and the Compute permissions
 * boundary are scoped to. Every value is a concrete string at synth time (the
 * account may still be an unresolved `Ref: AWS::AccountId` token when the app is
 * environment-agnostic, which CloudFormation resolves at deploy time).
 */
export interface ComputeDeployScopes {
  /** `arn:aws:iam::${account}:role/${prefix}-Compute-*` — the only IAM role scope. */
  readonly ownedRolePrefix: string;
  /** ARN of the deploy role itself, denied `iam:*` so it cannot mutate itself. */
  readonly deployRoleArn: string;
  /**
   * `arn:aws:cloudformation:${region}:${account}:stack/${prefix}-Compute/*` —
   * the Compute stack ARN pattern used in the deploy role's trust policy
   * `aws:SourceArn` condition. The trailing `/*` covers the stack's unique id.
   */
  readonly computeStackArnPattern: string;
  /** Managed-policy name of the Compute permissions boundary. */
  readonly boundaryName: string;
  /** ARN of {@link boundaryName}. */
  readonly boundaryArn: string;
  /**
   * The exact Lambda ARNs the Compute deploy role may mutate and invoke: the
   * nine `${prefix}-<service>` functions from {@link COMPUTE_FUNCTION_SUFFIXES}
   * plus `function:${prefix}-Compute-*` for the CFN-auto-named LogRetention
   * provider. Enumerated rather than `function:${prefix}-*` so the Database
   * stack's `${prefix}-migrate` / `${prefix}-sync-db-passwords` (which hold DB
   * credentials) are excluded.
   */
  readonly ownedFunctionArns: string[];
  /** `secret:${prefix}/audit/*` — excludes the cicd and database secrets. */
  readonly auditSecretArn: string;
  /** `parameter/${prefix}/notifications/*` — the only parameters Compute writes. */
  readonly notificationParameterArn: string;
  /**
   * `arn:aws:kms:${region}:${account}:key/*` — account+region-wide by necessity,
   * not by choice. The storage CMK is created in the Storage stack and consumed
   * cross-stack, so its key id is not a synth-time literal here. The two KMS
   * statements this scopes are bounded by their `kms:ViaService` /
   * `kms:GrantIsForAWSResource` conditions rather than by this ARN.
   */
  readonly storageKeyArnPattern: string;
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
  public readonly ecrRepository: ecr.IRepository;
  public readonly pipeline?: codepipeline.Pipeline;
  /**
   * Standing, S3-sourced CodeBuild project that builds the Feedback Engine
   * image from a per-commit source snapshot. Created regardless of
   * `enablePipeline` — it is deployment infrastructure, not the CI/CD pipeline.
   */
  public readonly bootstrapImageBuild: codebuild.Project;

  /** CodeBuild project name the deploy workflow invokes to build the image. */
  public static bootstrapImageProjectNameFor(stackPrefix: string): string {
    return `${stackPrefix}-bootstrap-image`;
  }

  /**
   * S3 key prefix (in the CDK bootstrap assets bucket) under which the deploy
   * workflow uploads the per-commit `git archive` snapshot as `<sha>.zip`.
   */
  public static bootstrapSourcePrefixFor(stackPrefix: string): string {
    return `wren-bootstrap-source/${stackPrefix}`;
  }

  /**
   * Name of the CDK bootstrap assets bucket the snapshot is uploaded to and the
   * bootstrap project reads from. Uses the default CDK qualifier
   * (`hnb659fds`), matching the file-publishing bucket the pipeline already
   * references elsewhere in this stack.
   */
  public static bootstrapAssetsBucketNameFor(account: string, region: string): string {
    return `cdk-hnb659fds-assets-${account}-${region}`;
  }

  /**
   * Fixed name of the Compute permissions-boundary managed policy this stack owns.
   * Exposed as a static so `bin/wren.ts` and the synth tests reference the same
   * literal without holding a Cicd stack instance (the Cicd stack is conditional
   * on GitHub context being supplied).
   */
  public static boundaryPolicyNameFor(stackPrefix: string): string {
    return `${stackPrefix}-compute-boundary`;
  }

  /** ARN of {@link CicdStack.boundaryPolicyNameFor} in the given account. */
  public static boundaryPolicyArnFor(account: string, stackPrefix: string): string {
    return `arn:aws:iam::${account}:policy/${CicdStack.boundaryPolicyNameFor(stackPrefix)}`;
  }

  /** Name of the permissions boundary applied to every Compute-stack role. */
  public readonly computeBoundaryPolicyName: string;
  /** ARN of {@link computeBoundaryPolicyName}. */
  public readonly computeBoundaryPolicyArn: string;
  /** The permissions-boundary managed policy itself (Requirement 2 criterion 1). */
  public readonly computeBoundaryPolicy: iam.ManagedPolicy;
  /** Synth-time ARN literals the Compute deploy policy is scoped to. */
  public readonly computeDeployScopes: ComputeDeployScopes;

  constructor(scope: Construct, id: string, props: CicdStackProps) {
    super(scope, id, props);

    const { config } = props;

    this.computeDeployScopes = this.deriveComputeDeployScopes(config);
    this.computeBoundaryPolicyName = this.computeDeployScopes.boundaryName;
    this.computeBoundaryPolicyArn = this.computeDeployScopes.boundaryArn;

    // Created here, referenced by nothing yet (Fix_Commit C4). The
    // `StringEquals iam:PermissionsBoundary` gate lands in C6, the attachment to
    // the Compute construct tree in C5 — in that order, deliberately.
    this.computeBoundaryPolicy = this.createComputeBoundaryPolicy(config);

    const functionName = `${config.stackPrefix}-feedback-engine`;

    // -------------------------------------------------------------------
    // ECR Repository (Feedback Engine container image)
    // -------------------------------------------------------------------
    const repositoryName = `${config.stackPrefix}-feedback-engine`;
    const managedRepository = props.ecrOwnership !== "external";
    if (managedRepository) {
      const repository = new ecr.Repository(this, "FeedbackEngineRepo", {
        repositoryName,
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.MUTABLE,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [
          {
            description: "Remove only untagged images after 30 days; immutable release tags remain rollback-safe",
            tagStatus: ecr.TagStatus.UNTAGGED,
            maxImageAge: Duration.days(30),
            rulePriority: 1,
          },
        ],
      });
      repository.addToResourcePolicy(new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("lambda.amazonaws.com")],
        actions: [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
        ],
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": `arn:aws:lambda:${config.env.region}:${this.account}:function:${config.stackPrefix}-feedback-engine`,
          },
        },
      }));
      this.ecrRepository = repository;
    } else {
      this.ecrRepository = ecr.Repository.fromRepositoryName(
        this,
        "FeedbackEngineRepo",
        repositoryName,
      );
    }

    // -------------------------------------------------------------------
    // Bootstrap image build — standing, S3-sourced CodeBuild project.
    //
    // This is deployment infrastructure, NOT the ongoing CI/CD pipeline: it is
    // created unconditionally (before the `enablePipeline` guard below) so a
    // first-time `npm run deploy` can build the Feedback Engine container image
    // in AWS instead of on the operator's machine, removing the local Docker
    // daemon prerequisite. `enableCicd`/`enablePipeline` gates only the
    // pipeline resources further down.
    //
    // Source is an S3 object the deploy workflow uploads per commit
    // (`git archive <sha>` → `${BOOTSTRAP_SOURCE_PREFIX}/<sha>.zip` in the CDK
    // bootstrap assets bucket). The concrete key is supplied at build time via
    // `start-build --source-location-override`, so nothing here depends on the
    // Feedback Engine image existing — the dependency runs one way:
    // Cicd → bootstrap build → ECR image → Compute.
    const bootstrapAssetsBucket = s3.Bucket.fromBucketName(
      this,
      "BootstrapAssetsBucket",
      CicdStack.bootstrapAssetsBucketNameFor(this.account, config.env.region),
    );
    this.bootstrapImageBuild = new codebuild.Project(this, "BootstrapImageBuild", {
      projectName: `${config.stackPrefix}-bootstrap-image`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.MEDIUM,
        // Docker build runs inside CodeBuild; privileged mode is required.
        privileged: true,
      },
      environmentVariables: {
        // Overridden per build with the commit-scoped tag (`src-<shortsha>`).
        // The default is inert — a real deploy always overrides it.
        IMAGE_TAG: { value: "bootstrap" },
      },
      source: codebuild.Source.s3({
        bucket: bootstrapAssetsBucket,
        // Placeholder object under the stable prefix. The deploy workflow
        // overrides the source location per build with the SHA-keyed object,
        // so this key exists only to satisfy synth-time source config.
        path: `${CicdStack.bootstrapSourcePrefixFor(config.stackPrefix)}/HEAD.zip`,
      }),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              // Log in against the ECR registry host only (not the repo path).
              `aws ecr get-login-password --region ${config.env.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${config.env.region}.amazonaws.com`,
            ],
          },
          build: {
            commands: [
              `docker build -t ${this.ecrRepository.repositoryUri}:$IMAGE_TAG backend/engine/python/`,
              `docker push ${this.ecrRepository.repositoryUri}:$IMAGE_TAG`,
              // Keep the mutable `bootstrap` convenience tag current so
              // CloudFormation can always reference a concrete image. The
              // authoritative artifact is the digest recorded by the workflow.
              `docker tag ${this.ecrRepository.repositoryUri}:$IMAGE_TAG ${this.ecrRepository.repositoryUri}:bootstrap`,
              `docker push ${this.ecrRepository.repositoryUri}:bootstrap`,
            ],
          },
        },
      }),
    });

    this.ecrRepository.grantPullPush(this.bootstrapImageBuild);
    this.bootstrapImageBuild.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }));
    // Read the SHA-keyed source snapshot from the CDK bootstrap assets bucket.
    // No `s3:GetObjectVersion`: the snapshot is pinned by object key (the SHA),
    // never by VersionId, so version-scoped reads are never exercised.
    this.bootstrapImageBuild.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      resources: [
        bootstrapAssetsBucket.bucketArn,
        `${bootstrapAssetsBucket.bucketArn}/${CicdStack.bootstrapSourcePrefixFor(config.stackPrefix)}/*`,
      ],
    }));

    if (!props.enablePipeline) return;
    const repositoryOwner = props.repositoryOwner;
    const repositoryNameFromSource = props.repositoryName;
    const branch = props.branch;
    if (!repositoryOwner || !repositoryNameFromSource || !branch) {
      throw new Error("repositoryOwner, repositoryName, and branch are required when the CI/CD pipeline is enabled");
    }

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
              "npm run test:ci",
              "cd cdk && npm run typecheck && npm test -- --runInBand && cd ..",
              // ECR login before build so the push step is ready
              `aws ecr get-login-password --region ${config.env.region} | docker login --username AWS --password-stdin ${this.ecrRepository.repositoryUri}`,
            ],
          },
          build: {
            commands: [
              // Derive a prefixed, human-readable ECR tag (`src-<shortsha>`)
              // from the resolved commit SHA. Using the raw
              // $CODEBUILD_RESOLVED_SOURCE_VERSION (a 40-char hex SHA) would
              // leave the repo tagged with bare hex codes; `src-<shortsha>`
              // matches the operator deploy path (commitImageTag) so both build
              // routes tag identically and the tag is legible in the ECR console.
              "IMAGE_TAG=src-${CODEBUILD_RESOLVED_SOURCE_VERSION:0:12}",
              `docker build -t ${this.ecrRepository.repositoryUri}:$IMAGE_TAG backend/engine/python/`,
              `docker push ${this.ecrRepository.repositoryUri}:$IMAGE_TAG`,
              // Also keep bootstrap tag current so CloudFormation can always reference it
              `docker tag ${this.ecrRepository.repositoryUri}:$IMAGE_TAG ${this.ecrRepository.repositoryUri}:bootstrap`,
              `docker push ${this.ecrRepository.repositoryUri}:bootstrap`,
              `echo "${this.ecrRepository.repositoryUri}:$IMAGE_TAG" > image-uri.txt`,
              // Synth with the same stackPrefix/environment as this pipeline so
              // cdk.out/${stackPrefix}-Compute.assets.json actually exists
              // (cdk.json defaults to environmentName=dev otherwise).
              // Re-pass the armed first-admin subject when present so a
              // pipeline Compute update cannot strip TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT
              // before the candidate's first application login elevates them.
              `BOOTSTRAP_SUBJECT=$(aws ssm get-parameter --name ${ssmParameterNames.technicalAdminBootstrapSubject(config)} --query Parameter.Value --output text 2>/dev/null || true)`,
              `if [ "$BOOTSTRAP_SUBJECT" = "None" ] || [ "$BOOTSTRAP_SUBJECT" = "none" ]; then BOOTSTRAP_SUBJECT=""; fi`,
              `SUBJECT_CONTEXT=""`,
              `if [ -n "$BOOTSTRAP_SUBJECT" ]; then SUBJECT_CONTEXT="-c technicalAdminBootstrapSubject=$BOOTSTRAP_SUBJECT"; fi`,
              `cd cdk && npx cdk synth -c environmentName=${config.environmentName} -c projectName=${config.projectName} -c stackPrefix=${config.stackPrefix} -c feedbackEngineImageTag=$IMAGE_TAG -c auditPseudonymSaltOwnership=${config.auditPseudonymSaltOwnership} -c enableCicd=true -c ecrOwnership=${props.ecrOwnership ?? "managed"} -c githubOwner=${repositoryOwner} -c githubRepo=${repositoryNameFromSource} -c githubBranch=${branch} $SUBJECT_CONTEXT && npx cdk-assets publish --path cdk.out/${config.stackPrefix}-Compute.assets.json && cd ..`,
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

    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:${config.env.region}:${this.account}:parameter/${config.stackPrefix}/auth/technical-admin-bootstrap-subject`,
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
              owner: repositoryOwner,
              repo: repositoryNameFromSource,
              branch,
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
              adminPermissions: false,
              deploymentRole: this.createComputeDeploymentRole(config.stackPrefix),
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

    // Expire rebuildable pipeline artifacts so the Retain-policy bucket cannot
    // grow without bound. Mutate the existing auto-created bucket in place —
    // passing a new artifactBucket would orphan this one.
    const artifactBucket = this.pipeline.artifactBucket;
    if (artifactBucket instanceof s3.Bucket) {
      artifactBucket.addLifecycleRule({
        id: "ExpirePipelineArtifacts",
        expiration: Duration.days(90),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      });
    }
  }

  /**
   * Derive every ARN literal the Compute deploy policy and the Compute
   * permissions boundary are scoped to.
   *
   * The region comes from `config.env.region` (pinned by `resolveConfig`, never
   * from the ambient profile) rather than `this.region`, so the literals stay
   * stable even when the stack is synthesized environment-agnostically.
   *
   * `ownedRolePrefix` matches only the CloudFormation-auto-named roles of the
   * `${prefix}-Compute` stack; `deployRoleArn` (`…-compute-cfn-deploy`) is
   * outside it, and is denied explicitly rather than relying on IAM ARN case
   * sensitivity.
   */
  private deriveComputeDeployScopes(config: AppConfig): ComputeDeployScopes {
    const account = this.account;
    const region = config.env.region;
    const prefix = config.stackPrefix;

    return {
      ownedRolePrefix: `arn:aws:iam::${account}:role/${prefix}-Compute-*`,
      deployRoleArn: `arn:aws:iam::${account}:role/${prefix}-compute-cfn-deploy`,
      computeStackArnPattern: `arn:aws:cloudformation:${region}:${account}:stack/${prefix}-Compute/*`,
      boundaryName: CicdStack.boundaryPolicyNameFor(prefix),
      boundaryArn: CicdStack.boundaryPolicyArnFor(account, prefix),
      // Enumerated owned functions, deliberately NOT `function:${prefix}-*`:
      // that wildcard also matches the Database stack's `${prefix}-migrate` and
      // `${prefix}-sync-db-passwords`, which hold DB credentials. The nine named
      // service functions are listed explicitly; `${prefix}-Compute-*` covers
      // the CFN-auto-named LogRetention provider.
      ownedFunctionArns: [
        ...COMPUTE_FUNCTION_SUFFIXES.map(
          (suffix) => `arn:aws:lambda:${region}:${account}:function:${prefix}-${suffix}`,
        ),
        `arn:aws:lambda:${region}:${account}:function:${prefix}-Compute-*`,
      ],
      // Audit_Salt_Secret only. Excludes `${prefix}/cicd/` and `${prefix}/database/`.
      // Trailing `*` covers the six-character suffix Secrets Manager appends.
      auditSecretArn: `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/audit/*`,
      notificationParameterArn: `arn:aws:ssm:${region}:${account}:parameter/${prefix}/notifications/*`,
      // Shared by the deploy policy's two KMS statements and the boundary's
      // `Kms` statement, so all three are scoped by one literal.
      storageKeyArnPattern: `arn:aws:kms:${region}:${account}:key/*`,
    };
  }

  /**
   * Compute_Boundary_Policy — the permissions boundary every role the Compute
   * stack creates must carry (Requirement 2 criterion 1).
   *
   * This is the layer that makes an in-prefix role takeover non-catastrophic:
   * whatever inline or attached policy a malicious commit gives a
   * `${prefix}-Compute-*` role, the role's effective permissions are the
   * intersection of that policy with this document, and this document denies
   * `iam:*`, `sts:AssumeRole` and `organizations:*` outright (Requirement 2
   * criteria 5, 8). The escalation chain cannot continue past one hop.
   *
   * The action set is derived from the repository, not guessed: every
   * `addToRolePolicy` / `grant*` in `ComputeStack.ts`,
   * `AppSyncRealtimeConstruct.ts` and `NotificationInfraConstruct.ts`, plus the
   * documented contents of the three AWS managed policies the roles attach.
   * Those three were read off the AWS managed policy reference rather than
   * assumed (the design left one of them open):
   *   - `AWSLambdaBasicExecutionRole` v1 — `logs:CreateLogGroup`,
   *     `CreateLogStream`, `PutLogEvents` on `"*"`.
   *   - `AWSLambdaVPCAccessExecutionRole` v3 — those three logs actions plus
   *     `ec2:CreateNetworkInterface`, `DescribeNetworkInterfaces`,
   *     `DescribeSubnets`, `DeleteNetworkInterface`, `AssignPrivateIpAddresses`,
   *     `UnassignPrivateIpAddresses`. Six ec2 actions, not eight:
   *     `ec2:DescribeSecurityGroups` and `ec2:DescribeVpcs` are *not* in it.
   *     `VpcEni` below keeps them anyway — a boundary is an upper bound, and
   *     the Lambda VPC attach path has historically been documented with both.
   *   - `AWSAppSyncPushToCloudWatchLogs` v1 — `logs:CreateLogGroup`,
   *     `CreateLogStream`, `PutLogEvents` only. The design flagged
   *     `logs:DescribeLogGroups` as unconfirmed; it is **not** in the policy.
   *     `Logs` below still admits `DescribeLogGroups`/`DescribeLogStreams`
   *     because AWS versions these policies and the actions are read-only.
   *
   * Requirement 2 criterion 6 ("a resource ARN pattern owned by Compute_Stack")
   * is read as "scoped by `stackPrefix` within the deployment account and
   * region, or an action with no resource-level permissions" — see the design's
   * interpretation note. The boundary is attached to the eleven live runtime
   * roles, whose legitimate access is largely to resources owned by OTHER
   * stacks: the per-role database secrets (`${prefix}/database/*`, Database
   * stack), the documents/reference buckets and the storage CMK (Storage
   * stack), the conversation table (Storage stack), the Cognito user pool
   * (Cognito stack). Admitting only Compute-owned ARNs would leave the deploy
   * green and the application returning 500s. Do not over-tighten this.
   *
   * A too-tight boundary fails silently and late, so it is validated three
   * ways: the offline subset check of every synthesized runtime statement, the
   * post-deploy functional smoke pass, and a CloudWatch Logs `AccessDenied`
   * sweep (validation steps V6–V8).
   *
   * Size: a managed policy document is capped at 6,144 characters and a
   * principal carries exactly one boundary, so this document cannot be split.
   * If headroom runs out, drop `Tracing` first — no Lambda in the Compute stack
   * sets `tracing: Tracing.ACTIVE`, so nothing currently uses those actions.
   */
  private createComputeBoundaryPolicy(config: AppConfig): iam.ManagedPolicy {
    const account = this.account;
    const region = config.env.region;
    const prefix = config.stackPrefix;
    // S3 bucket names are lowercased by CloudFormation auto-naming
    // (`<lowercased-stack-name>-<logical-id>-<suffix>`), so the documents and
    // reference buckets of the `${prefix}-Storage` stack are
    // `${lowerPrefix}-storage-…`. Verified against the Storage constructs: no
    // bucket sets an explicit `bucketName`. Validation step V5 confirms this
    // against the deployed names before C5 ships; if it differs, widen to
    // `arn:aws:s3:::${lowerPrefix}-*`, never to `"*"`.
    const lowerPrefix = prefix.toLowerCase();

    return new iam.ManagedPolicy(this, "ComputeBoundary", {
      managedPolicyName: this.computeBoundaryPolicyName,
      description: "Permissions boundary for every IAM role the Compute stack creates.",
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            // AWSLambdaBasicExecutionRole + AWSLambdaVPCAccessExecutionRole +
            // AWSAppSyncPushToCloudWatchLogs logs actions, plus the retention
            // actions the CDK LogRetention provider role calls. The two
            // `Describe*` actions are a deliberate superset: none of the three
            // managed policies grants them today (checked against the AWS
            // managed policy reference), and they are read-only.
            sid: "Logs",
            actions: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "logs:PutRetentionPolicy",
              "logs:DeleteRetentionPolicy",
              "logs:DescribeLogGroups",
              "logs:DescribeLogStreams",
            ],
            resources: [`arn:aws:logs:${region}:${account}:*`],
          }),
          new iam.PolicyStatement({
            // AWSLambdaVPCAccessExecutionRole v3 (six ec2 actions) plus
            // `ec2:DescribeSecurityGroups` / `ec2:DescribeVpcs` as headroom.
            // None of these actions supports resource-level permissions in the
            // form Lambda's VPC attach uses, so `"*"` is the only resource
            // that works here.
            sid: "VpcEni",
            actions: [
              "ec2:CreateNetworkInterface",
              "ec2:DeleteNetworkInterface",
              "ec2:DescribeNetworkInterfaces",
              "ec2:AssignPrivateIpAddresses",
              "ec2:UnassignPrivateIpAddresses",
              "ec2:DescribeSubnets",
              "ec2:DescribeSecurityGroups",
              "ec2:DescribeVpcs",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            // X-Ray accepts only `"*"`. Unused today (no function enables
            // active tracing); this is the first statement to drop if the
            // 6,144-character document limit gets tight.
            sid: "Tracing",
            actions: [
              "xray:PutTraceSegments",
              "xray:PutTelemetryRecords",
              "xray:GetSamplingRules",
              "xray:GetSamplingTargets",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            // `${prefix}/database/*` is owned by the Database stack and is what
            // every function uses to reach Postgres through RDS Proxy;
            // `${prefix}/audit/*` is Audit_Salt_Secret. Both are required at
            // runtime. `${prefix}/cicd/*` is excluded here and denied outright
            // below.
            sid: "Secrets",
            actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
            resources: [
              `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/database/*`,
              `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/audit/*`,
            ],
          }),
          new iam.PolicyStatement({
            // Reads span the whole `/${prefix}/*` subtree (toast/notification
            // config, bedrock model id, the bootstrap-subject parameter the
            // admin function reads for de-elevation protection). Reads cannot
            // escalate, so the broad scope is intentional headroom.
            sid: "ParametersRead",
            actions: [
              "ssm:GetParameter",
              "ssm:GetParameters",
              "ssm:GetParametersByPath",
            ],
            resources: [`arn:aws:ssm:${region}:${account}:parameter/${prefix}/*`],
          }),
          new iam.PolicyStatement({
            // `ssm:PutParameter` is scoped to the ONLY parameter a runtime role
            // writes: `/${prefix}/config/bedrock-model-id` (admin function,
            // `putBedrockModelIdToSsm`). On the former `/${prefix}/*` scope a
            // tampered runtime role could overwrite
            // `/${prefix}/auth/technical-admin-bootstrap-subject` — the
            // operator-armed first-admin gate the admin function treats as the
            // source of truth for protected subjects — and the rest of the
            // subtree. Those are deploy-time-only parameters and are
            // intentionally non-writable at runtime.
            sid: "ParametersWriteBedrockModelOnly",
            actions: ["ssm:PutParameter"],
            resources: [
              `arn:aws:ssm:${region}:${account}:parameter${bedrockModelIdParameterName(config)}`,
            ],
          }),
          new iam.PolicyStatement({
            // Documents + reference buckets (Storage stack). `s3:DeleteObjects`
            // mirrors the document function's grant; the batch delete API
            // authorizes as `s3:DeleteObject`, so it is inert but kept so the
            // boundary is a superset of every synthesized runtime statement.
            sid: "Objects",
            actions: [
              "s3:GetObject",
              "s3:GetObjectVersion",
              "s3:GetObjectTagging",
              "s3:PutObject",
              "s3:PutObjectTagging",
              "s3:DeleteObject",
              "s3:DeleteObjects",
              "s3:DeleteObjectTagging",
              "s3:ListBucket",
            ],
            resources: [
              `arn:aws:s3:::${lowerPrefix}-storage-*`,
              `arn:aws:s3:::${lowerPrefix}-storage-*/*`,
            ],
          }),
          new iam.PolicyStatement({
            // The storage CMK is consumed cross-stack, so its key id is not a
            // synth-time literal here; account+region scoping is the tightest
            // available. `grantEncryptDecrypt` produces the first four.
            //
            // Same literal as the deploy policy's two KMS statements, taken from
            // `computeDeployScopes` so the boundary cannot drift narrower than
            // the policy it bounds. Unlike those statements this one carries no
            // `kms:ViaService` condition: a boundary is an upper bound, and
            // gating it would make the intersection depend on a key that is
            // absent for any future direct KMS call a runtime function makes.
            sid: "Kms",
            actions: [
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:ReEncrypt*",
              "kms:GenerateDataKey*",
              "kms:DescribeKey",
            ],
            resources: [this.computeDeployScopes.storageKeyArnPattern],
          }),
          new iam.PolicyStatement({
            // `${prefix}-ConversationHistory` (Storage stack).
            sid: "Table",
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem",
              "dynamodb:Query",
            ],
            resources: [`arn:aws:dynamodb:${region}:${account}:table/${prefix}-*`],
          }),
          new iam.PolicyStatement({
            // `${prefix}-feedback-queue`, `-feedback-dlq`,
            // `-document-ingest-queue`, `-document-ingest-dlq`,
            // `-notification-queue`, `-notification-dlq`.
            sid: "Queues",
            actions: [
              "sqs:SendMessage",
              "sqs:ReceiveMessage",
              "sqs:DeleteMessage",
              "sqs:GetQueueAttributes",
              "sqs:GetQueueUrl",
              "sqs:ChangeMessageVisibility",
            ],
            resources: [`arn:aws:sqs:${region}:${account}:${prefix}-*`],
          }),
          new iam.PolicyStatement({
            // `${prefix}-notification-events`.
            sid: "Topics",
            actions: ["sns:Publish"],
            resources: [`arn:aws:sns:${region}:${account}:${prefix}-*`],
          }),
          new iam.PolicyStatement({
            // `grantMutation` targets are field-level ARNs
            // (`apis/<id>/types/Mutation/fields/<field>`), which `apis/*`
            // matches — IAM wildcards span `/`.
            sid: "Realtime",
            actions: ["appsync:GraphQL"],
            resources: [`arn:aws:appsync:${region}:${account}:apis/*`],
          }),
          new iam.PolicyStatement({
            // Foundation models are account-less ARNs; inference profiles and
            // guardrails are account-scoped. Region is `*` because the
            // us.anthropic.* / us.meta.* CRIS profiles fan out cross-region.
            sid: "BedrockInvoke",
            actions: [
              "bedrock:InvokeModel",
              "bedrock:InvokeModelWithResponseStream",
              "bedrock:GetInferenceProfile",
              "bedrock:ApplyGuardrail",
            ],
            resources: [
              "arn:aws:bedrock:*::foundation-model/*",
              `arn:aws:bedrock:*:${account}:inference-profile/*`,
              `arn:aws:bedrock:*:${account}:guardrail/*`,
            ],
          }),
          new iam.PolicyStatement({
            // List operations have no resource-level permissions.
            sid: "BedrockList",
            actions: ["bedrock:ListFoundationModels", "bedrock:ListInferenceProfiles"],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            // Textract has no resource-level permissions.
            sid: "Ocr",
            actions: [
              "textract:AnalyzeDocument",
              "textract:DetectDocumentText",
              "textract:StartDocumentAnalysis",
              "textract:GetDocumentAnalysis",
              "textract:StartDocumentTextDetection",
              "textract:GetDocumentTextDetection",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            // Cognito user pool (Cognito stack): authorizer auto-provisioning
            // and the admin group sync.
            sid: "Directory",
            actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsersInGroup"],
            resources: [`arn:aws:cognito-idp:${region}:${account}:userpool/*`],
          }),
          new iam.PolicyStatement({
            // Requirement 2 criteria 5, 8. This is the cap. With `iam:*` denied
            // a boundary-capped role cannot create roles, attach policies or
            // PassRole; with `sts:AssumeRole` denied it cannot pivot. Denying
            // `sts:AssumeRole` here constrains the role as a *caller* only —
            // who may assume the role is decided by its trust policy, so
            // nothing breaks.
            sid: "DenyPrivilegeEscalation",
            effect: iam.Effect.DENY,
            actions: ["iam:*", "sts:AssumeRole", "organizations:*"],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            // The runtime roles have no business reading the pipeline's own
            // GitHub PAT (`${prefix}/cicd/github-pat`). `Secrets` above does not
            // match it; this makes that explicit and survives a future widening
            // of the Allow.
            sid: "DenyPipelineSecrets",
            effect: iam.Effect.DENY,
            actions: ["secretsmanager:*"],
            resources: [`arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/cicd/*`],
          }),
        ],
      }),
    });
  }

  /**
   * CloudFormation execution role for `${stackPrefix}-Compute` only.
   * Not account admin. Too-narrow failures show up in CFN events — add the
   * missing action; do not restore adminPermissions.
   */
  private createComputeDeploymentRole(stackPrefix: string): iam.Role {
    // Derived once in `deriveComputeDeployScopes`; never re-derived inline, so
    // the policy, the boundary and the synth tests share one literal.
    const {
      ownedRolePrefix,
      deployRoleArn,
      boundaryArn,
      ownedFunctionArns,
      auditSecretArn,
      notificationParameterArn,
      storageKeyArnPattern,
      computeStackArnPattern,
    } = this.computeDeployScopes;

    return new iam.Role(this, "ComputeDeployRole", {
      roleName: `${stackPrefix}-compute-cfn-deploy`,
      // Confused-deputy guard. A bare `cloudformation.amazonaws.com` principal
      // lets any caller in any account that can reach CloudFormation ask it to
      // assume this role; the two conditions bind use of the role to
      // CloudFormation acting (a) within THIS account (`aws:SourceAccount`) and
      // (b) on behalf of the `${prefix}-Compute` stack specifically
      // (`aws:SourceArn`). CloudFormation populates both keys when it assumes an
      // execution role. If a legitimate Compute deploy is ever denied by the
      // ArnLike check (e.g. a stack rename), relax to the `aws:SourceAccount`
      // condition alone before widening any further — never drop both.
      assumedBy: new iam.PrincipalWithConditions(
        new iam.ServicePrincipal("cloudformation.amazonaws.com"),
        {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": computeStackArnPattern },
        },
      ),
      description: "Scoped CFN execution role for the Compute stack (not account admin).",
      inlinePolicies: {
        ComputeDeploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "LambdaCompute",
              actions: [
                "lambda:AddPermission",
                "lambda:CreateEventSourceMapping",
                "lambda:CreateFunction",
                "lambda:DeleteEventSourceMapping",
                "lambda:DeleteFunction",
                "lambda:DeleteFunctionConcurrency",
                "lambda:DeleteFunctionEventInvokeConfig",
                "lambda:GetEventSourceMapping",
                "lambda:GetFunction",
                "lambda:GetFunctionConfiguration",
                "lambda:ListTags",
                "lambda:ListVersionsByFunction",
                "lambda:PublishVersion",
                "lambda:PutFunctionConcurrency",
                "lambda:PutFunctionEventInvokeConfig",
                "lambda:RemovePermission",
                "lambda:TagResource",
                "lambda:UntagResource",
                "lambda:UpdateEventSourceMapping",
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration",
              ],
              // Scoped to the enumerated Compute-owned functions
              // (`ownedFunctionArns`), NOT `"*"`. On `"*"` these mutation
              // actions reached every Lambda in the account, including the
              // Database stack's `${prefix}-migrate` and
              // `${prefix}-sync-db-passwords` — a Compute deploy could then
              // `UpdateFunctionCode` on them and exfiltrate the RDS admin / per-
              // role Postgres secrets they are granted, or
              // `UpdateFunctionConfiguration` on `${prefix}-authorizer` to arm
              // `TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT` with an attacker's Cognito
              // sub. Those two Database-stack functions share the `${prefix}-`
              // prefix, so only an enumerated list excludes them. A new Compute
              // function must be added to `COMPUTE_FUNCTION_SUFFIXES` or its
              // deploy surfaces the missing permission in the CFN events — add
              // the suffix, never restore `"*"`.
              resources: ownedFunctionArns,
            }),
            new iam.PolicyStatement({
              // Requirement 5 criteria 1, 4, 6. `ownedFunctionArns` covers both
              // invocation targets a Compute deploy needs: the nine explicitly
              // named `${prefix}-<service>` functions and the
              // CloudFormation-auto-named `${prefix}-Compute-LogRetention*`
              // provider that backs the `Custom::LogRetention` resources.
              //
              // Do NOT narrow this to `function:${prefix}-Compute-*` alone:
              // that matches the LogRetention provider but none of the named
              // service functions, so it would break the deploy. Equally, do
              // NOT widen it back to `function:${prefix}-*` — that also matches
              // the Database stack's `${prefix}-migrate` /
              // `${prefix}-sync-db-passwords`, letting a Compute deploy invoke
              // credential-bearing functions outside its scope. The enumerated
              // list is the exact set that satisfies both constraints.
              sid: "LambdaInvokeOwnedFunctions",
              actions: ["lambda:InvokeFunction"],
              resources: ownedFunctionArns,
            }),
            // -----------------------------------------------------------
            // IAM: the former `IamForLambdaRoles` statement, split by
            // condition-key behaviour and scoped to Owned_Role_Prefix.
            // `arn:aws:iam::${account}:role/*` is gone (Requirement 1
            // criteria 1, 2).
            // -----------------------------------------------------------
            new iam.PolicyStatement({
              sid: "IamRoleMutationWithBoundary",
              actions: [
                "iam:AttachRolePolicy",
                "iam:CreateRole",
                "iam:PutRolePermissionsBoundary",
                "iam:PutRolePolicy",
              ],
              resources: [ownedRolePrefix],
              // Requirement 2 criteria 2–4, design statement 1.3. The gate is
              // enforceable now because Fix_Commit C5 has attached
              // `${prefix}-compute-boundary` to every in-prefix role: on
              // `PutRolePolicy` / `AttachRolePolicy` the `iam:PermissionsBoundary`
              // key reflects the boundary already attached to the *target* role,
              // so the condition is satisfied for exactly the roles the Compute
              // deploy touches.
              //
              // `StringEquals`, never `StringEqualsIfExists` (Requirement 2
              // criterion 3, Requirement 3 criterion 4, Requirement 7
              // criterion 4). An absent key yields an unsatisfied condition and
              // therefore an implicit deny — the behaviour Requirement 2
              // criterion 4 relies on — so no companion Deny statement is added
              // for the missing-key case.
              //
              // `iam:PutRolePermissionsBoundary` sits inside the gate on
              // purpose: the deploy role can attach *only* this boundary and can
              // never swap in a weaker one (Requirement 2 criteria 5–8).
              // Removal is closed separately by `DenyBoundaryRemoval`.
              //
              // The condition value is the constructed literal from
              // `deriveComputeDeployScopes`, never
              // `computeBoundaryPolicy.managedPolicyArn`: referencing the
              // construct attribute would make this policy depend on the
              // managed policy resource within the template, and the design
              // requires a constructed literal so the same string can be
              // reproduced by `bin/wren.ts` and the synth tests.
              conditions: {
                StringEquals: { "iam:PermissionsBoundary": boundaryArn },
              },
            }),
            new iam.PolicyStatement({
              // Requirement 2 criterion 10: trust-policy mutation is granted
              // unconditionally, scoped to Owned_Role_Prefix. Out-of-prefix
              // trust-policy rewrites are closed by `DenyOutOfScopeStacks`
              // (Requirement 4), not by a permissions-boundary condition.
              //
              // Validation step V0 (IAM service authorization reference,
              // "Actions defined by AWS Identity and Access Management (IAM)",
              // row `UpdateAssumeRolePolicy`, checked against
              // docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html):
              // the reference DOES list `iam:PermissionsBoundary` as a
              // supported condition key for `UpdateAssumeRolePolicy`, alongside
              // `aws:ResourceTag/${TagKey}` and `iam:ResourceTag/${TagKey}`.
              // The design predicted the opposite. The prediction was wrong;
              // the shape below is still correct. The key on this action
              // reflects the boundary attached to the target role, so once C5
              // has attached the boundary to every in-prefix role a
              // `StringEquals` gate would be satisfiable but redundant with the
              // resource scope, and it would fail closed for any in-prefix role
              // whose boundary was lost — which is exactly the state teardown
              // has to be able to recover from. Recorded here so a future
              // reviewer sees the finding rather than the guess.
              // (`iam:RoleTemplateARN`, the sibling key, is still absent for
              // this action, which is what the design was reading.)
              sid: "IamRoleTrustPolicy",
              actions: ["iam:UpdateAssumeRolePolicy"],
              resources: [ownedRolePrefix],
            }),
            new iam.PolicyStatement({
              // `iam:PassRole` stands alone (Requirement 3 criterion 1): IAM
              // populates `iam:PassedToService` only on PassRole requests and
              // does not populate `iam:PermissionsBoundary` for it at all, so
              // it cannot share a statement with the boundary-gated set.
              //
              // `StringEquals`, never `StringEqualsIfExists` (Requirement 3
              // criterion 4, Requirement 7 criterion 4). That operator is what
              // made the old `IamForLambdaRoles` statement vacuous: the key is
              // absent for CreateRole/PutRolePolicy/etc., so `…IfExists`
              // evaluated true and constrained nothing. With `StringEquals`, a
              // PassRole request that carries no `iam:PassedToService` — a
              // direct `iam:PassRole` call outside a service integration —
              // fails the condition and is implicitly denied.
              //
              // Exactly two service principals, covering all eleven
              // PassRole_Targets (Requirement 3 criteria 3, 6; Requirement 6
              // criterion 1): `lambda.amazonaws.com` for the nine service
              // function execution roles plus the CDK LogRetention provider
              // role, and `appsync.amazonaws.com` for the AppSync API logs role
              // consumed as `LogConfig.CloudWatchLogsRoleArn`.
              //
              // `events.amazonaws.com` is deliberately omitted (Requirement 3
              // criterion 7): the only EventBridge integration in the Compute
              // stack, `OverrideExpiryRule`, invokes the notification function
              // through an `AWS::Lambda::Permission` resource policy and passes
              // no role to EventBridge, so EventBridge is never a PassRole
              // target here.
              sid: "IamPassRoleToComputeServices",
              actions: ["iam:PassRole"],
              resources: [ownedRolePrefix],
              conditions: {
                StringEquals: {
                  "iam:PassedToService": [
                    "lambda.amazonaws.com",
                    "appsync.amazonaws.com",
                  ],
                },
              },
            }),
            new iam.PolicyStatement({
              // Deliberately ungated. `iam:PermissionsBoundary` is not
              // populated for `GetRolePolicy`, `ListRolePolicies`,
              // `ListAttachedRolePolicies`, `TagRole` or `UntagRole`, so a
              // `StringEquals` gate would deny them permanently and break
              // every stack update (CloudFormation reads role state first),
              // every delete and rollback (teardown calls `DeleteRolePolicy`,
              // `DetachRolePolicy`, `DeleteRole`) and tag propagation from
              // `applyStandardTags`. None of these actions can grant a
              // principal permissions, so ungated adds no escalation path.
              //
              // `iam:UpdateRole` is omitted (Requirement 1 criterion 6): no
              // Compute-stack role sets `Description` or `MaxSessionDuration`.
              // If a future revision sets either, CloudFormation surfaces
              // `… /${prefix}-compute-cfn-deploy is not authorized to perform:
              // iam:UpdateRole` in the stack events; the remedy is to add
              // `iam:UpdateRole` to this statement, on Owned_Role_Prefix and
              // nothing wider (Requirement 1 criterion 7).
              sid: "IamRoleReadTagAndTeardown",
              actions: [
                "iam:DeleteRole",
                "iam:DeleteRolePolicy",
                "iam:DetachRolePolicy",
                "iam:GetRole",
                "iam:GetRolePolicy",
                "iam:ListAttachedRolePolicies",
                "iam:ListRolePolicies",
                "iam:TagRole",
                "iam:UntagRole",
              ],
              resources: [ownedRolePrefix],
            }),
            new iam.PolicyStatement({
              sid: "MessagingRealtimeAndConfig",
              actions: [
                "sqs:*",
                "sns:*",
                "events:*",
                "appsync:*",
                "logs:*",
                "ssm:AddTagsToResource",
                "ssm:DeleteParameter",
                "ssm:GetParameter",
                "ssm:GetParameters",
                // `ssm:PutParameter` is NOT here — it lives in
                // `SsmPutNotificationParameters` below (Requirement 5
                // criterion 3). The four actions left on `"*"` are read, tag
                // and delete only; none of them can create or overwrite a
                // parameter value, so they carry no configuration-tampering
                // escalation path.
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              // Requirement 5 criteria 2, 4, 7; Requirement 10 criteria 6, 7.
              //
              // Why the WHOLE Secrets Manager block moves, not just
              // `GetSecretValue`: Requirement 5 criterion 2 constrains only
              // `secretsmanager:GetSecretValue`, but Audit_Salt_Secret
              // (`${prefix}/audit/pseudonym-salt`) is the only secret the
              // Compute stack creates or reads at all. Leaving
              // `PutSecretValue`, `UpdateSecret` and `DeleteSecret` on `"*"`
              // would let a malicious commit overwrite or destroy
              // Github_Pat_Secret (`${prefix}/cicd/github-pat`) and the
              // per-role Postgres secrets (`${prefix}/database/*`) — not a read
              // escalation, but a self-inflicted outage vector, and Requirement
              // 10 criteria 6–7 direct that any scope matching resources the
              // Compute stack does not own be narrowed.
              //
              // The pattern deliberately excludes `${prefix}/cicd/` and
              // `${prefix}/database/`. The broader `secret:${prefix}/*` would
              // match both — that over-match is the recorded instance of the
              // over-matching scope failure mode (Requirement 5 criterion 7,
              // Requirement 10 criterion 6).
              //
              // The trailing `*` is required, not sloppy: Secrets Manager
              // appends a six-character suffix to the physical ARN, e.g.
              // `…:secret:wren-dev/audit/pseudonym-salt-AbCdEf`.
              sid: "SecretsManagerOwnedSecrets",
              actions: [
                "secretsmanager:CreateSecret",
                "secretsmanager:DeleteSecret",
                "secretsmanager:DescribeSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:PutSecretValue",
                "secretsmanager:TagResource",
                "secretsmanager:UntagResource",
                "secretsmanager:UpdateSecret",
              ],
              resources: [auditSecretArn],
            }),
            new iam.PolicyStatement({
              // Requirement 5 criteria 3, 4.
              //
              // The seven `NotificationInfraConstruct` parameters
              // (`toast-duration-ms`, `toast-max-visible`,
              // `delivery-target-ms`, `default-dedup-window-min`,
              // `usage-warning-threshold-pct`, `dlq-threshold`,
              // `override-expiry-warning-hours`) are the only parameters the
              // Compute stack writes, and they all sit under
              // `/${prefix}/notifications/`. The parameter name's leading slash
              // merges with the `parameter/` ARN segment, so the literal is
              // `parameter/${prefix}/notifications/*`, not
              // `parameter//${prefix}/…`.
              //
              // What this excludes, and why it matters:
              // `parameter/${prefix}/config/bedrock-model-id` is written at
              // RUNTIME by the admin function (`ComputeStack` grants
              // `ssm:PutParameter` on that ARN to the admin role), never by a
              // CloudFormation deploy. Leaving `PutParameter` on `"*"` let the
              // deploy role silently repoint the Bedrock model the whole
              // application invokes. It is not writable under this pattern.
              sid: "SsmPutNotificationParameters",
              actions: ["ssm:PutParameter"],
              resources: [notificationParameterArn],
            }),
            new iam.PolicyStatement({
              sid: "VpcLambdaEni",
              actions: [
                "ec2:AssignPrivateIpAddresses",
                "ec2:CreateNetworkInterface",
                "ec2:DeleteNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeSubnets",
                "ec2:DescribeVpcs",
                "ec2:UnassignPrivateIpAddresses",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              sid: "EcrImageResolve",
              actions: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetAuthorizationToken",
                "ecr:GetDownloadUrlForLayer",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              sid: "CdkAssetBucketRead",
              actions: [
                "s3:GetObject",
                "s3:GetObjectVersion",
                "s3:GetBucketLocation",
                "s3:ListBucket",
              ],
              resources: [
                `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}`,
                `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`,
              ],
            }),
            new iam.PolicyStatement({
              // Finding F-4. The former `KmsUseExistingStorageKey` statement
              // carried these five actions plus `kms:CreateGrant` on
              // `Resource: "*"` — use of, and decryption with, every CMK in the
              // account whose key policy delegates to IAM (which is every CMK
              // CDK creates, including the ones this repo does not own), in
              // every region, plus cross-account keys whose policy trusts this
              // account.
              //
              // The resource scope alone does not close that: `key/*` is the
              // tightest ARN available here, because the storage CMK is created
              // in the Storage stack and its key id is not a synth-time literal
              // in this stack. `kms:ViaService` is what actually bounds the
              // statement — the role can reach a key only when S3 or DynamoDB
              // calls KMS on its behalf, never as a direct `Decrypt` of
              // arbitrary ciphertext it has obtained some other way.
              //
              // Only those two services appear because they are the only ones
              // that take a CMK anywhere in this repo (`StorageResources.ts`:
              // both buckets and `ConversationHistory`). No Compute-stack
              // resource takes a CMK property today — no `environmentEncryption`
              // on any function, no CMK on any queue — so this statement is
              // headroom for a future CMK-bearing resource rather than a
              // present-day dependency. If one is added in another service, the
              // CFN events name the key and the missing action; add that
              // service's `kms:ViaService` value here and nothing wider.
              sid: "KmsUseStorageKeyViaService",
              actions: [
                "kms:Decrypt",
                "kms:DescribeKey",
                "kms:Encrypt",
                "kms:GenerateDataKey",
                "kms:GenerateDataKeyWithoutPlaintext",
              ],
              resources: [storageKeyArnPattern],
              conditions: {
                StringEquals: {
                  "kms:ViaService": [
                    `s3.${this.region}.amazonaws.com`,
                    `dynamodb.${this.region}.amazonaws.com`,
                  ],
                },
              },
            }),
            new iam.PolicyStatement({
              // `kms:CreateGrant` stands alone, for the same reason
              // `iam:PassRole` does above: `kms:GrantIsForAWSResource` is
              // populated only for grant operations and `kms:ViaService` is not
              // populated for a direct `CreateGrant`, so folding the two
              // condition sets into one statement would leave one set of
              // actions permanently unsatisfiable.
              //
              // `CreateGrant` is the reason F-4 is not merely an over-broad read
              // grant. It is a delegation primitive: on an unconditioned
              // statement the role can mint a grant naming any principal as
              // grantee on any reachable key, and grants outlive the policy that
              // created them — revoking the statement later does not revoke
              // grants already issued under it.
              //
              // `GrantIsForAWSResource` admits the only legitimate `CreateGrant`
              // a CloudFormation execution role ever makes: an AWS service
              // creating a grant on the caller's behalf while provisioning a
              // CMK-encrypted resource. Naming an arbitrary grantee is denied.
              //
              // `Bool` is outside the operator subset modelled by
              // `test/support/policyEval.ts`, which throws rather than guessing.
              // The existing property tests never reach it — `statementMatches`
              // short-circuits on action and resource before evaluating
              // conditions, and they generate only `iam:` actions — but any new
              // assertion that evaluates a `kms:` action through `evaluate()`
              // must add `Bool` to `SUPPORTED_CONDITION_OPERATORS` first.
              sid: "KmsCreateGrantForAwsResourcesOnly",
              actions: ["kms:CreateGrant"],
              resources: [storageKeyArnPattern],
              conditions: {
                Bool: { "kms:GrantIsForAWSResource": "true" },
              },
            }),
            new iam.PolicyStatement({
              // NotResource denies role mutations outside Owned_Role_Prefix.
              // The pre-existing non-role actions remain denied everywhere:
              // their resource types can never match the excluded IAM role ARN.
              // `iam:DeleteRolePermissionsBoundary` is deliberately absent here:
              // it is denied everywhere by `DenyBoundaryRemoval` below, which
              // this NotResource inversion would have weakened to out-of-prefix
              // roles only.
              sid: "DenyOutOfScopeStacks",
              effect: iam.Effect.DENY,
              actions: [
                "rds:*",
                "cognito-idp:*",
                "apigateway:*",
                "organizations:*",
                "s3:CreateBucket",
                "s3:DeleteBucket",
                "iam:CreateUser",
                "iam:DeleteUser",
                "iam:CreateAccessKey",
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:AttachRolePolicy",
                "iam:UpdateAssumeRolePolicy",
                "iam:PutRolePermissionsBoundary",
              ],
              notResources: [ownedRolePrefix],
            }),
            new iam.PolicyStatement({
              // Design statement 1.12. Deliberately `Resource: "*"`, NOT
              // `NotResource: [ownedRolePrefix]` like `DenyOutOfScopeStacks`:
              // the boundary must not be strippable even from an in-prefix
              // role. An in-prefix `DeleteRolePermissionsBoundary` would be the
              // cheapest way to reopen finding
              // f-6d6bc078-eeba-4830-bff5-c04d9b96b223 — detach the boundary
              // from a runtime role, and that role's identity policy applies
              // unbounded again.
              //
              // Consequence, accepted knowingly: rolling the boundary back is
              // not something the pipeline can do. It requires a deliberate
              // `CicdStack` edit (remove or narrow this Deny, deploy Cicd, then
              // remove the aspect in `bin/wren.ts`) — see the design's rollback
              // path. A too-tight boundary is instead fixed by editing the
              // managed policy and deploying Cicd only, which needs no boundary
              // removal at all.
              sid: "DenyBoundaryRemoval",
              effect: iam.Effect.DENY,
              actions: ["iam:DeleteRolePermissionsBoundary"],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              // Requirement 1 criterion 3, discharged unconditionally.
              //
              // Owned_Role_Prefix (`…role/${prefix}-Compute-*`) already
              // excludes this role (`…role/${prefix}-compute-cfn-deploy`) IF
              // IAM resource ARN matching is case-sensitive — `Compute-`
              // versus `compute-`. IAM documents resource matching as
              // case-sensitive, but IAM role *names* are unique
              // case-insensitively, and the closure of finding
              // f-6d6bc078-eeba-4830-bff5-c04d9b96b223 should not rest on that
              // distinction. This explicit self-Deny removes the dependency on
              // case semantics entirely: no IAM action in this policy can reach
              // the deploy role's own ARN, whatever the matching semantics.
              sid: "DenySelfMutation",
              effect: iam.Effect.DENY,
              actions: ["iam:*"],
              resources: [deployRoleArn],
            }),
          ],
        }),
      },
    });
  }
}
