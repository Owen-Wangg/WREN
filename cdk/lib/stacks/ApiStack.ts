import * as fs from "fs";
import * as path from "path";
import YAML from "js-yaml";
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

    // Read the OpenAPI spec and load it as an object. The spec contains
    // Fn::Sub references (CloudFormation intrinsics) which SpecRestApi will
    // handle correctly via JSON representation.
    const specPath = path.join(__dirname, "..", "openapi.yaml");
    const rawSpec = fs.readFileSync(specPath, "utf8");

    // Parse YAML to JSON object.
    const specObject = YAML.load(rawSpec) as Record<string, any>;

    // Resolve all Fn::Sub intrinsics and Lambda ARN placeholders into plain
    // strings. Since we know all values at synth time (region + Lambda ARNs),
    // we don't need CloudFormation to resolve them at deploy time.
    const substitutions: Record<string, string> = {
      "AWS::Region": config.env.region,
      AuthorizerFunctionArn: String(props.authorizerFunctionArn),
      DocumentFunctionArn: String(props.documentFunctionArn),
      FeedbackFunctionArn: String(props.feedbackFunctionArn),
      AdminFunctionArn: String(props.adminFunctionArn),
      AuditFunctionArn: String(props.auditFunctionArn),
    };

    function resolveSpec(obj: any): any {
      if (typeof obj !== "object" || obj === null) return obj;
      if (Array.isArray(obj)) return obj.map(resolveSpec);

      // If this object is a Fn::Sub intrinsic, resolve it to a plain string.
      if ("Fn::Sub" in obj && typeof obj["Fn::Sub"] === "string") {
        let resolved = obj["Fn::Sub"] as string;
        for (const [key, value] of Object.entries(substitutions)) {
          resolved = resolved.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
        }
        return resolved;
      }

      // Otherwise recurse into all keys.
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = resolveSpec(value);
      }
      return result;
    }

    const resolvedSpec = resolveSpec(specObject);

    // -----------------------------------------------------------------------
    // Inject CORS OPTIONS mock integration on every path.
    // This bypasses the Lambda authorizer for preflight requests (security: [])
    // and returns CORS headers via a MOCK integration (no Lambda invocation).
    // -----------------------------------------------------------------------
    const allowedOrigins = "*"; // Tighten to Amplify domain in prod
    const corsResponseParams = {
      "method.response.header.Access-Control-Allow-Origin": `'${allowedOrigins}'`,
      "method.response.header.Access-Control-Allow-Methods": "'GET,POST,PUT,DELETE,OPTIONS'",
      "method.response.header.Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
    };

    if (resolvedSpec.paths) {
      for (const pathValue of Object.values(resolvedSpec.paths as Record<string, any>)) {
        if (!pathValue.options) {
          pathValue.options = {
            summary: "CORS preflight",
            security: [],
            responses: {
              "200": {
                description: "CORS preflight response",
                headers: {
                  "Access-Control-Allow-Origin": { schema: { type: "string" } },
                  "Access-Control-Allow-Methods": { schema: { type: "string" } },
                  "Access-Control-Allow-Headers": { schema: { type: "string" } },
                },
              },
            },
            "x-amazon-apigateway-integration": {
              type: "mock",
              requestTemplates: { "application/json": '{"statusCode": 200}' },
              responses: {
                default: {
                  statusCode: "200",
                  responseParameters: corsResponseParams,
                },
              },
            },
          };
        }
      }
    }

    this.api = new apigateway.SpecRestApi(this, `${id}-RestApi`, {
      apiDefinition: apigateway.ApiDefinition.fromInline(resolvedSpec),
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

    // Grant API Gateway permission to invoke each Lambda. The functions live in
    // the Compute stack, so they are imported by ARN here — but with
    // `sameEnvironment: true` so CDK knows they share this stack's account/region
    // and actually emits the `AWS::Lambda::Permission` (a bare `fromFunctionArn`
    // silently no-ops `addPermission()` across token-ARN boundaries).
    const invokableFunctions = [
      { id: "AuthorizerFn", arn: props.authorizerFunctionArn },
      { id: "DocumentFn", arn: props.documentFunctionArn },
      { id: "FeedbackFn", arn: props.feedbackFunctionArn },
      { id: "AdminFn", arn: props.adminFunctionArn },
      { id: "AuditFn", arn: props.auditFunctionArn },
    ];

    for (const svc of invokableFunctions) {
      const fn = lambda.Function.fromFunctionAttributes(this, svc.id, {
        functionArn: svc.arn,
        sameEnvironment: true,
      });
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
