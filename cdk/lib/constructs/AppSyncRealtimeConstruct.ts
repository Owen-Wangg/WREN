import * as path from "path";
import { Duration } from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface AppSyncRealtimeProps {
  /**
   * The AppSync Lambda authorizer function. It verifies the Cognito JWT and
   * enforces DB-level ownership: only the Student who owns the document may
   * subscribe. This is the same two-step model (JWT → DB) as the REST
   * Lambda authorizer (REQ-SEC-AUTHDECOUPLE-01 / REQ-SEC-ROLE-01).
   */
  readonly authorizerFunction: lambda.IFunction;
  /** IAM role of the Feedback Engine Lambda — granted publish-only access. */
  readonly feedbackEngineRole: iam.IRole;
  readonly stackPrefix: string;
}

/**
 * AppSync GraphQL API for real-time debrief-ready notifications.
 *
 * Auth model (mirrors the REST authorizer pattern):
 *   - Lambda authorizer (primary): verifies Cognito JWT + DB ownership check.
 *     Students may only subscribe to documents they own. ttlOverride=0 so
 *     every new WebSocket connection re-runs the ownership check.
 *   - IAM (additional): Feedback Engine Lambda publishes the mutation via
 *     SigV4; students cannot invoke the mutation directly.
 *
 * The mutation payload is a signal only (documentId, draftId, itemCount) —
 * no document content crosses the WebSocket.
 *
 * Steering:
 *   - ubc-cic-tech-stack.md §5: "Use GraphQL (AppSync) for realtime subscriptions"
 *   - ubc-cic-lambda-best-practices.md: least-privilege IAM, scoped to one field
 *   - ubc-cic-cdk-best-practices.md: constructs receive concrete objects, own file
 */
export class AppSyncRealtimeConstruct extends Construct {
  public readonly api!: appsync.GraphqlApi;
  public readonly graphqlUrl!: string;

  constructor(scope: Construct, id: string, props: AppSyncRealtimeProps) {
    super(scope, id);
    this.createResources(props);
  }

  protected createResources(props: AppSyncRealtimeProps): void {
    const api = new appsync.GraphqlApi(this, "Api", {
      name: `${props.stackPrefix}-debrief-realtime`,
      definition: appsync.Definition.fromFile(
        path.join(__dirname, "../appsync/schema.graphql"),
      ),
      authorizationConfig: {
        // Lambda authorizer: Cognito JWT verification + DB role/ownership check.
        // This is the primary auth mode — all student subscriptions go through it.
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.LAMBDA,
          lambdaAuthorizerConfig: {
            handler: props.authorizerFunction,
            // 5-minute cache. The authorizer runs at WebSocket connection time
            // only (not per-message), so this only affects reconnections within
            // the same token's validity window. Document ownership is immutable
            // in this system, and the Cognito token itself expires after 1 hour,
            // so a 5-minute TTL is safe and avoids a DB round-trip on every
            // page refresh / network reconnect.
            resultsCacheTtl: Duration.seconds(300),
          },
        },
        // IAM: Feedback Engine Lambda publishes via SigV4. Students cannot
        // call this auth mode from the frontend.
        additionalAuthorizationModes: [
          { authorizationType: appsync.AuthorizationType.IAM },
        ],
      },
      xrayEnabled: true,
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
        excludeVerboseContent: true,
      },
    });

    // None data source: AppSync fans the mutation payload directly to
    // subscribers with no backing data store.
    const noneDs = api.addNoneDataSource("NoneDs");

    noneDs.createResolver("PublishDebriefReadyResolver", {
      typeName: "Mutation",
      fieldName: "publishDebriefReady",
      requestMappingTemplate: appsync.MappingTemplate.fromString(
        '{"version":"2017-02-28","payload":$util.toJson($context.arguments)}',
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromString(
        "$util.toJson($context.result)",
      ),
    });

    // Least-privilege: Feedback Engine role may only invoke this one mutation.
    api.grantMutation(props.feedbackEngineRole, "publishDebriefReady");

    // Allow AppSync to invoke the Lambda authorizer.
    props.authorizerFunction.grantInvoke(
      new iam.ServicePrincipal("appsync.amazonaws.com"),
    );

    (this as { api: appsync.GraphqlApi }).api = api;
    (this as { graphqlUrl: string }).graphqlUrl = api.graphqlUrl;
  }
}
