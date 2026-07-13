import * as path from "path";
import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { AppConfig } from "../config";

/**
 * Props for the Api stack. Receives the Lambda function ARNs that the OpenAPI
 * spec's `x-amazon-apigateway-integration` references via CloudFormation
 * variables (Fn::Sub). These are wired in at synth time by passing them as
 * spec variables.
 */
export interface ApiStackProps extends StackProps {
  readonly config: AppConfig;
  /** ARN of the Lambda authorizer function (Cognito JWT verification + app-DB identity mapping). */
  readonly authorizerFunctionArn: string;
  /** ARN of the Document/Draft service Lambda. */
  readonly documentFunctionArn: string;
  /** ARN of the Feedback Engine orchestration Lambda (enqueue + status). */
  readonly feedbackFunctionArn: string;
  /** ARN of the Admin/Config/Auth/Usage service Lambda. */
  readonly adminFunctionArn: string;
  /** ARN of the Audit/Activity-Log/Analytics service Lambda. */
  readonly auditFunctionArn: string;
}

/**
 * `${StackPrefix}-Api` — REST API Gateway (SpecRestApi from OpenAPI spec).
 *
 * - Regional endpoint (fronted by CloudFront in a later stack).
 * - Lambda authorizer (Cognito JWT → app-DB identity + role + scope).
 * - Throttling: 100 req/s sustained, 200 burst.
 * - Logging: ERROR level (raised to INFO for debugging).
 * - Request validation at the edge via `x-amazon-apigateway-request-validator`.
 *
 * Requirements: REQ-SEC-ROLE-01 (API-layer enforcement), REQ-NFR-SCALE-01
 * (graceful degradation via throttling), REQ-NFR-LATENCY-01 (loading states
 * for in-flight feedback).
 */
export class ApiStack extends Stack {
  public readonly api: apigateway.SpecRestApi;
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config } = props;

    // The OpenAPI spec references these Lambda ARNs via Fn::Sub variables.
    // SpecRestApi passes them through as CloudFormation parameters that get
    // substituted into the spec at deploy time.
    this.api = new apigateway.SpecRestApi(this, `${id}-RestApi`, {
      apiDefinition: apigateway.ApiDefinition.fromAsset(
        path.join(__dirname, "..", "openapi.yaml"),
        // {
        //   // Variables are injected via Fn::Sub in the spec
        // },
      ),
      restApiName: `${config.stackPrefix}-api`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: config.environmentName,
        metricsEnabled: true,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        tracingEnabled: true, // X-Ray tracing
      },
      cloudWatchRole: true,
    });

    // Grant API Gateway permission to invoke the authorizer Lambda.
    const authorizerFunction = lambda.Function.fromFunctionArn(
      this,
      "AuthorizerFn",
      props.authorizerFunctionArn,
    );
    authorizerFunction.addPermission("ApiGatewayInvoke", {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: this.api.arnForExecuteApi(),
    });

    // Grant API Gateway permission to invoke each service Lambda.
    const serviceFunctions = [
      { id: "DocumentFn", arn: props.documentFunctionArn },
      { id: "FeedbackFn", arn: props.feedbackFunctionArn },
      { id: "AdminFn", arn: props.adminFunctionArn },
      { id: "AuditFn", arn: props.auditFunctionArn },
    ];

    for (const svc of serviceFunctions) {
      const fn = lambda.Function.fromFunctionArn(this, svc.id, svc.arn);
      fn.addPermission(`${svc.id}-ApiGatewayInvoke`, {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        sourceArn: this.api.arnForExecuteApi(),
      });
    }

    this.apiEndpoint = this.api.url;

    new CfnOutput(this, "ApiEndpoint", {
      value: this.api.url,
      description: "WREN REST API endpoint URL",
    });

    new CfnOutput(this, "ApiId", {
      value: this.api.restApiId,
      description: "API Gateway REST API ID",
    });
  }
}
