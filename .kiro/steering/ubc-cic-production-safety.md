---
inclusion: always
---

# Production Safety

**CRITICAL**: When interacting with AWS resources and credentials, the following rules are MANDATORY:

1. **Credential Selection** — Use ReadOnly or least privilege credentials over Admin credentials for any operation that does not require write access
2. **Production Resource Deletion** — MUST NOT delete resources in production environments without explicit user direction because this could cause service outages or data loss
3. **Assume Production When Uncertain** — If you cannot determine whether a resource or credential is production, assume it IS production and act with maximum caution
4. **Non-Destructive Operations** — Prefer read, describe, or list operations over modify, update, or delete operations whenever possible
5. **Destructive Action Confirmation** — MUST request explicit user confirmation before any potentially destructive actions in production (delete, terminate, modify) and clearly explain the impact
6. **Safety Protection Disablement** — MUST NOT disable safety protections in production without explicit user confirmation and clear justification. This includes termination protection, deletion protection, MFA delete, versioning, backup retention policies, and similar safeguards

## Identifying Production Resources and Credentials

**Credential types** — Identify by:
- Checking `~/.aws/config` profile names for patterns like `ReadOnly`, `Admin`, `Prod`, or `Beta`
- Running `aws sts get-caller-identity` to check the role name in the ARN
- Running `aws iam list-attached-role-policies --role-name <role>` to see attached policies. Exercise caution when policies include `AdministratorAccess` or `FullAccess`

**Production resources** — Look for these indicators:
- Resource names or tags containing `prod`, `production`, or `prd`
- Absence of `dev`, `test`, `beta`, `alpha`, `staging`, or `sandbox` indicators
