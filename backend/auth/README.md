# `@wren/auth` — Auth_Service (Node 22)

Cognito JWT verification plus **app-database identity mapping** for the API
Gateway Lambda authorizer. Implements the decoupling contract of
REQ-SEC-AUTHDECOUPLE-01 / REQ-SEC-ROLE-01 (design "Request / Authorization Flow").

## The decoupling guarantee

The identity provider proves **authentication only**. The single fact that
crosses from authentication into authorization is the opaque token **subject**
(`sub`). Everything the platform authorizes on — roles, Organization/Writing-Type
scopes, and Access Grants — is read from Postgres, which is the single source of
truth.

- `tokenVerifier.ts` verifies signature / issuer / expiry with `aws-jwt-verify`
  and returns **only** the subject. IdP groups/claims/attributes are discarded
  and never reach authorization (Requirement 37.3).
- `identityMapping.ts` maps that subject to an {@link AuthContext} using
  parameterized queries against `app_user`, `role_assignment`, and `access_grant`
  (Requirement 37.2, 37.5; SQL injection safe per Requirement 39.2).
- `authorizer.ts` emits a coarse, cacheable IAM policy plus a serialized
  authorization context (roles, scopes, Writing-Type assignments, grants) that
  each downstream service **re-checks** against the specific operation (dual
  enforcement, Requirement 36.1/36.2).

Because no authorization logic reads IdP data, swapping Cognito for another
provider only means swapping the `TokenVerifier` implementation (Requirement 37.4).

## Layout

| File | Responsibility |
|------|----------------|
| `src/tokenVerifier.ts` | `aws-jwt-verify` Cognito verification → subject only |
| `src/identityMapping.ts` | subject → `AuthContext` from Postgres (parameterized) |
| `src/authorizer.ts` | TOKEN-authorizer handler; IAM policy + authz context |
| `src/config.ts` | non-secret Cognito pool/client env resolution |

The `AuthContext` type lives in `@wren/types` (single source of truth) so
Document/Admin/Config services (tasks 3.3 / 3.5) import the same shape.

## CDK integration seam

The `Api` stack (a later task) wires `handler` from this package as a
`TokenAuthorizer`, passing the Cognito ids via the environment variables in
`AUTHORIZER_ENV_KEYS` and the `DB_SECRET_ARN` / RDS Proxy env consumed by
`@wren/db-node`. Until then the handler and identity-mapping module are fully
importable, typed, and unit-tested.

## Test / typecheck

```bash
npm run -w @wren/auth typecheck   # tsc --noEmit
npx jest backend/auth             # unit tests
```
