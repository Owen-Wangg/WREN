/**
 * Frontend origin allowlists for API Gateway CORS, Lambda responses, and S3.
 *
 * API Gateway MOCK OPTIONS can reflect a request Origin when it matches an
 * exact origin or the Amplify default-domain regex. S3 CORS cannot use a regex,
 * but it does accept a single `*` in an origin string (`https://*.amplifyapp.com`).
 */

export const LOCAL_FRONTEND_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
] as const;

/** S3 AllowedOrigin pattern (one `*` per AWS CORS rules) for Amplify hosts. */
export const AMPLIFY_APP_S3_ORIGIN = "https://*.amplifyapp.com";

/**
 * Java/VTL regex for Amplify default hosts (`branch.appId.amplifyapp.com`).
 * Uses `[.]` instead of backslashes so Velocity does not eat the escapes.
 */
export const AMPLIFY_APP_ORIGIN_VTL_REGEX =
  "^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?[.]amplifyapp[.]com$";

export const CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
export const CORS_ALLOW_HEADERS =
  "Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent";

export interface CorsOriginConfig {
  readonly customDomain?: string;
  readonly corsAllowedOrigins?: readonly string[];
}

const EXACT_ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;

/** True when `value` is a scheme://host[:port] origin with no path, query, or `*`. */
export function isExactOrigin(value: string): boolean {
  if (!EXACT_ORIGIN.test(value) || value.includes("*")) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/**
 * Parse `-c corsAllowedOrigins=https://a.example,https://b.example`.
 * Empty/absent yields no extra origins (localhost + customDomain still apply).
 */
export function parseCorsAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const origin = part.trim();
    if (origin.length === 0) continue;
    if (!isExactOrigin(origin)) {
      throw new Error(
        `corsAllowedOrigins contains invalid origin '${origin}'. ` +
          "Use scheme://host[:port] with no path, query, or wildcard.",
      );
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/** Exact browser origins known at synth time (never `*`). */
export function exactFrontendOrigins(config: CorsOriginConfig): string[] {
  const origins = new Set<string>(LOCAL_FRONTEND_ORIGINS);
  if (config.customDomain) {
    origins.add(`https://${config.customDomain}`);
    if (!config.customDomain.startsWith("www.")) {
      origins.add(`https://www.${config.customDomain}`);
    }
  }
  for (const extra of config.corsAllowedOrigins ?? []) {
    origins.add(extra);
  }
  return [...origins];
}

/**
 * Documents-bucket CORS origins. Includes the Amplify subdomain wildcard
 * because S3 cannot evaluate the Amplify regex used by API Gateway.
 */
export function s3CorsAllowedOrigins(config: CorsOriginConfig): string[] {
  return [...exactFrontendOrigins(config), AMPLIFY_APP_S3_ORIGIN];
}

/** Lambda env so aws_proxy responses echo the same allowlist as OPTIONS. */
export function corsLambdaEnvironment(config: CorsOriginConfig): Record<string, string> {
  return {
    CORS_ALLOWED_ORIGINS: exactFrontendOrigins(config).join(","),
    CORS_ALLOW_AMPLIFY_ORIGINS: "true",
  };
}

function escapeVtlDoubleQuoted(value: string): string {
  if (/["$#\\]/.test(value)) {
    throw new Error(`CORS origin contains characters that cannot be embedded in VTL: ${value}`);
  }
  return value;
}

/**
 * MOCK integration response template: reflect Origin when it is allowlisted
 * (exact match or Amplify default host). Disallowed origins get no ACAO header.
 */
export function corsPreflightResponseTemplate(config: CorsOriginConfig): string {
  const comparisons = exactFrontendOrigins(config)
    .map((origin) => `$origin == "${escapeVtlDoubleQuoted(origin)}"`)
    .join(" || ");
  return [
    '#set($origin = $input.params().header.get("Origin"))',
    '#if(!$origin || $origin == "")',
    '#set($origin = $input.params().header.get("origin"))',
    "#end",
    `#if($origin && (${comparisons} || $origin.matches("${AMPLIFY_APP_ORIGIN_VTL_REGEX}")))`,
    "#set($context.responseOverride.header.Access-Control-Allow-Origin = $origin)",
    '#set($context.responseOverride.header.Vary = "Origin")',
    "#end",
    "{}",
  ].join("\n");
}
