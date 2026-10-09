import { Fn, Token } from "aws-cdk-lib";

/**
 * Security response headers served by Amplify Hosting for the SPA.
 *
 * Amplify reads these from the app's `customHeaders` YAML. The CSP limits
 * `connect-src` to the exact hosts the SPA calls:
 *   - the REST API (`VITE_API_BASE_URL`)
 *   - Cognito user pools (`amazon-cognito-identity-js`)
 *   - AppSync GraphQL over HTTPS and the AppSync realtime WebSocket
 *   - the documents bucket (presigned S3 POST uploads)
 *
 * See https://docs.aws.amazon.com/amplify/latest/userguide/custom-headers.html
 */

export interface AmplifyCspInputs {
  /** REST API base URL the SPA calls (may contain CDK tokens). */
  readonly apiEndpoint: string;
  /** AppSync GraphQL HTTPS URL (may be a CDK token). */
  readonly appSyncGraphqlUrl: string;
  /** Name of the S3 bucket the SPA uploads documents to (may be a CDK token). */
  readonly documentsBucketName: string;
  /** Region hosting Cognito, S3, and the APIs. */
  readonly region: string;
}

export interface SecurityHeader {
  readonly key: string;
  readonly value: string;
}

const SCHEME_AND_HOST = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i;

/**
 * Host portion of a URL. Literal strings (including strings with embedded
 * CDK tokens that do not span the host boundary) are parsed in TypeScript;
 * fully opaque tokens are split with CloudFormation intrinsics at deploy time.
 */
export function urlHost(url: string): string {
  const match = SCHEME_AND_HOST.exec(url);
  if (match?.[1]) return match[1];
  if (Token.isUnresolved(url)) return Fn.select(2, Fn.split("/", url));
  throw new Error(`Cannot determine host of URL '${url}'.`);
}

/**
 * AppSync realtime host for a GraphQL host:
 * `<id>.appsync-api.<region>.amazonaws.com` →
 * `<id>.appsync-realtime-api.<region>.amazonaws.com`.
 */
export function appSyncRealtimeHost(graphqlHost: string): string {
  if (graphqlHost.includes("appsync-api")) {
    return graphqlHost.replace("appsync-api", "appsync-realtime-api");
  }
  if (Token.isUnresolved(graphqlHost)) {
    return Fn.join("appsync-realtime-api", Fn.split("appsync-api", graphqlHost));
  }
  return graphqlHost;
}

/** Content-Security-Policy for the SPA. */
export function buildContentSecurityPolicy(inputs: AmplifyCspInputs): string {
  const { region } = inputs;
  const appSyncHost = urlHost(inputs.appSyncGraphqlUrl);

  const connectSrc = [
    "'self'",
    `https://${urlHost(inputs.apiEndpoint)}`,
    `https://cognito-idp.${region}.amazonaws.com`,
    `https://${appSyncHost}`,
    `wss://${appSyncRealtimeHost(appSyncHost)}`,
    `https://${inputs.documentsBucketName}.s3.${region}.amazonaws.com`,
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    // Tailwind/shadcn and the editor set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    // Draft images are data: URIs or absolute https URLs; exports use blob:.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src ${connectSrc.join(" ")}`,
  ].join("; ");
}

/** All security headers applied to every Amplify-served path. */
export function buildSecurityHeaders(inputs: AmplifyCspInputs): SecurityHeader[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(inputs) },
  ];
}

/**
 * Amplify `customHeaders` YAML. Values are single-quoted YAML scalars, so any
 * literal `'` (e.g. `'self'`) is doubled.
 */
export function buildAmplifyCustomHeadersYaml(inputs: AmplifyCspInputs): string {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const lines = ["customHeaders:", "  - pattern: '**'", "    headers:"];
  for (const header of buildSecurityHeaders(inputs)) {
    lines.push(`      - key: ${quote(header.key)}`);
    lines.push(`        value: ${quote(header.value)}`);
  }
  return `${lines.join("\n")}\n`;
}
