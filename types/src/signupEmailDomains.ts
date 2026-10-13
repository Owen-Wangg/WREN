/**
 * Deploy-time signup email-domain allowlist (exact hostname match).
 *
 * Fail closed: an empty/absent list DENIES every new self-signup. A non-empty
 * list allows only new Cognito sign-ups whose email hostname equals one of the
 * configured domains (case-insensitive). Subdomains are not implied and there
 * are no wildcards: `ubc.ca` does not allow `law.ubc.ca`.
 */

/** Conservative hostname: two or more labels, lowercase `[a-z0-9-]`, no scheme/path. */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.)+${LABEL}$`);

/** Short Cognito PreSignUp error; the frontend maps this to a domain-named message. */
export const SIGNUP_EMAIL_DOMAIN_DENIED =
  "Sign-up is limited to approved email domains.";

export function isAllowedEmailDomainHostname(domain: string): boolean {
  return domain.length <= 253 && HOSTNAME.test(domain);
}

/**
 * Parse a comma/whitespace-separated list of exact email hostnames.
 * Empty or absent input yields an empty allowlist (denies signup). Unknown or
 * malformed tokens fail loud so a typo cannot silently mis-configure signup.
 */
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
        `${sourceName} must be bare lowercase hostnames like 'ubc.ca' (no scheme, path, or trailing dot).`,
      );
    }
    if (!result.includes(domain)) result.push(domain);
  }
  return result;
}

/** Hostname after the last `@`, lowercased. Undefined when the value is not an email. */
export function emailHostname(email: string): string | undefined {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Whether a signup email is allowed. Fail closed: an EMPTY allowlist denies
 * every email. Matching is exact and case-insensitive.
 */
export function isSignupEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) return false;
  const host = emailHostname(email);
  if (host === undefined) return false;
  return allowedDomains.includes(host);
}

/** User-facing signup error that names the configured domains. */
export function signupEmailDomainRestrictionMessage(
  allowedDomains: readonly string[],
): string {
  if (allowedDomains.length === 0) return SIGNUP_EMAIL_DOMAIN_DENIED;
  if (allowedDomains.length === 1) {
    return `Sign-up is limited to @${allowedDomains[0]} addresses.`;
  }
  const listed = allowedDomains.map((domain) => `@${domain}`).join(", ");
  return `Sign-up is limited to these email domains: ${listed}.`;
}

/** Serialize the allowlist for Lambda/Amplify env (empty string when none). */
export function allowedEmailDomainsEnv(domains: readonly string[]): string {
  return domains.join(",");
}
