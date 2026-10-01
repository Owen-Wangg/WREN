/**
 * Signup email-domain policy helpers for CDK synth/deploy.
 *
 * Keep in sync with `types/src/signupEmailDomains.ts`. Duplicated here so CDK
 * Jest/tsc stay inside this package (ts-jest cannot compile files outside
 * `cdk/` as part of this project). Runtime matching for Cognito and the
 * frontend still lives in `@wren/types`.
 *
 * Secure by default: an empty allowlist DENIES signup unless open signup is
 * explicitly enabled. Matching is exact; there is no wildcard syntax.
 */

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);

export interface SignupPolicy {
  readonly allowedDomains: readonly string[];
  readonly allowOpenSignup: boolean;
}

export function isAllowedEmailDomainHostname(domain: string): boolean {
  return domain.length <= 253 && HOSTNAME.test(domain);
}

export function parseAllowedEmailDomains(
  raw: string | undefined,
  sourceName = "Allowed email domains",
): string[] {
  if (raw === undefined) return [];
  const result: string[] = [];
  for (const token of raw.split(/[,\s]+/)) {
    const domain = token.trim();
    if (domain.length === 0) continue;
    if (!isAllowedEmailDomainHostname(domain)) {
      throw new Error(
        `${sourceName} must be bare lowercase hostnames like 'ubc.ca' (no scheme, path, wildcard, or trailing dot).`,
      );
    }
    if (!result.includes(domain)) result.push(domain);
  }
  return result;
}

export function emailHostname(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}

/** Exact hostname match. An EMPTY allowlist matches nothing. */
export function isEmailDomainAllowlisted(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  const host = emailHostname(email);
  if (host === undefined) return false;
  return allowedDomains.includes(host);
}

/** Restricted when the list is non-empty; otherwise only an explicit opt-in allows. */
export function isSignupAllowed(email: string, policy: SignupPolicy): boolean {
  if (policy.allowedDomains.length > 0) {
    return isEmailDomainAllowlisted(email, policy.allowedDomains);
  }
  return policy.allowOpenSignup === true;
}

/** Why a signup policy is invalid (missing or contradictory), else `undefined`. */
export function signupPolicyProblem(
  policy: SignupPolicy,
  names: { readonly domains: string; readonly openSignup: string } = {
    domains: "allowedEmailDomains",
    openSignup: "allowOpenSignup",
  },
): string | undefined {
  const restricted = policy.allowedDomains.length > 0;
  if (restricted && policy.allowOpenSignup) {
    return `${names.domains} and ${names.openSignup}=true are mutually exclusive. Keep the allowlist to restrict signup, or remove it and set ${names.openSignup}=true to allow any email.`;
  }
  if (!restricted && !policy.allowOpenSignup) {
    return `${names.domains} is required (for example 'ubc.ca,student.ubc.ca'). To deliberately allow signup from any email domain, set ${names.openSignup}=true instead.`;
  }
  return undefined;
}

export function allowedEmailDomainsEnv(domains: readonly string[]): string {
  return domains.join(",");
}
