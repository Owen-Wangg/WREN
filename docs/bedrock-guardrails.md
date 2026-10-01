# Bedrock Guardrails

## Table of Contents

- [Overview](#overview)
- [Guardrail Configuration](#guardrail-configuration)
- [Content Filters](#content-filters)
- [Defense Layers](#defense-layers)
- [Runtime Behavior](#runtime-behavior)
- [Monitoring](#monitoring)
- [Cross-References](#cross-references)

## Overview

**What it is.** WREN has one Amazon Bedrock Guardrail. It is a `CfnGuardrail` resource defined inside the `AppConfigParameters` construct and created by the Config stack.

**What it protects.** Admin-authored prompt configuration. When a Department Admin or Technical Admin saves a document-type or department prompt, the text goes through the Bedrock `ApplyGuardrail` API for a prompt-injection check before it is saved.

**What it does not protect.** Student content and model output. Those are handled by application-level controls, described under [Defense Layers](#defense-layers).

The guardrail runs through the `ApplyGuardrail` API rather than inline guardrail parameters on the `InvokeModel` call. That screens the admin-controlled configuration text at its own trust boundary and keeps the guardrail separate from the feedback-generation model calls.

Throughout this document, the **no-ghostwriting invariant** means: WREN may identify writing problems and ask questions about them, but it must not generate replacement text a student could paste into their document.

## Guardrail Configuration

### CDK Resource

The guardrail lives in the `AppConfigParameters` construct and is created by the **Config** stack (`wren-dev-Config`). The `aws-cdk-lib/aws_bedrock` L1 construct maps to the CloudFormation `AWS::Bedrock::Guardrail` resource.

```typescript
// cdk/lib/constructs/AppConfigParameters.ts
const promptGuardrail = new bedrock.CfnGuardrail(this, "PromptInjectionGuardrail", {
  name: `${config.stackPrefix}-prompt-injection`,
  description: "Detects prompt injection attempts in admin-submitted prompt fields.",
  blockedInputMessaging: "Prompt contains disallowed instructions.",
  blockedOutputsMessaging: "Response blocked.",
  contentPolicyConfig: {
    filtersConfig: [
      {
        type: "PROMPT_ATTACK",
        inputStrength: "MEDIUM",
        outputStrength: "NONE",
      },
    ],
  },
});
```

Configured policy: `PROMPT_ATTACK` at MEDIUM input strength. No other Bedrock Guardrail policies are configured. `blockedOutputsMessaging` is required by the resource but unused, since the runtime call only uses `source: 'INPUT'`.

### Environment Variables

The Config stack writes the guardrail id and version to SSM, and the Compute stack copies the id into the Admin Lambda environment at deploy time. The Admin Lambda is the only runtime consumer.

| SSM Parameter | Value |
|---------------|-------|
| `/{stackPrefix}/config/prompt-guardrail-id` | `promptGuardrail.attrGuardrailId` |
| `/{stackPrefix}/config/prompt-guardrail-version` | `"DRAFT"` |

| Environment Variable | Source |
|----------------------|--------|
| `PROMPT_GUARDRAIL_ID` | `props.promptGuardrailId` (from `AppConfigParameters.promptGuardrailIdParameter`) |
| `PROMPT_GUARDRAIL_VERSION` | Literal `"DRAFT"` |

### Versioning

The guardrail runs on version `DRAFT`. To pin an immutable published version, add a `CfnGuardrailVersion` resource and point `PROMPT_GUARDRAIL_VERSION` (and the SSM version parameter) at it.

### IAM

The Admin Lambda role gets `bedrock:ApplyGuardrail`, scoped to `arn:aws:bedrock:<region>:<account>:guardrail/*` (see `cdk/lib/stacks/ComputeStack.ts`). `InvokeModel` for the Feedback Engine is a separate policy on the engine role. The Admin Lambda reaches Bedrock Runtime over the `BedrockRuntime` interface endpoint in `NetworkResources.ts` (or NAT).

## Content Filters

The guardrail applies a single content-policy filter, on input only:

| Category | Input Strength | Output Strength |
|----------|---------------|-----------------|
| PROMPT_ATTACK | MEDIUM | NONE |

MEDIUM input strength catches jailbreak and instruction-override attempts while flagging fewer legitimate coaching instructions than HIGH would. Output strength is NONE because the guardrail is only ever called with `source: 'INPUT'`.

## Defense Layers

WREN layers five defenses. Only the first is a Bedrock Guardrail; the rest are application-level and cover the student debrief path, which the Bedrock Guardrail does not touch.

### Layer 1: Bedrock Guardrail

The `PROMPT_ATTACK` filter screens admin-submitted prompt fields via `ApplyGuardrail` (`source: 'INPUT'`) before they are saved. This is the only Bedrock Guardrail resource in the project. See [Guardrail Configuration](#guardrail-configuration) and [Runtime Behavior](#runtime-behavior).

### Layer 2: Ghostwriting Validation

Before the Bedrock call, `assertGhostwritingFree` (`backend/admin/src/promptGuardrail.ts`) scans admin prompt text for instructions that would violate the no-ghostwriting invariant — for example "rewrite this", "provide a corrected version", "suggest a replacement". A match throws `PromptGuardrailError` (`GHOSTWRITING_DETECTED`) → HTTP 400, with no partial save. This is application logic, not Bedrock.

The **Ask WREN department prompt is not screened by the Bedrock Guardrail. It is subject to this application-level ghostwriting check** (via `assertGhostwritingFree` in `departmentService.ts`, alongside the Layer 1 injection check).

The check is intentionally conservative: keeping ghostwriting instructions out of the Feedback Engine matters more than the occasional false positive.

### Layer 3: Untrusted-Data Isolation

Student draft text is never treated as instructions. During prompt assembly (`backend/engine/python/wren_engine/prompt_assembly.py`), it is wrapped in a delimited block:

```text
BEGIN UNTRUSTED DATA [{boundary_token}] label={block.label}
  {student draft / reference material}
END UNTRUSTED DATA [{boundary_token}]
```

A randomized boundary token is generated during prompt assembly, so submitted content can't reliably close the block early (REQ-SEC-PROMPTINJECT-01). The system scaffolding tells the model to treat everything inside the block as data, never instructions.

### Layer 4: Model-Level Instructions

The Feedback Engine embeds a `_GUARDRAIL` string in the system prompt (`backend/engine/python/handler.py`) — natural-language rules for the model, not a Bedrock resource. They enforce the no-ghostwriting invariant: identify the location and type of an error but never supply the correction, and never reference internal instructions or configuration in feedback output. When a document type has no `type_prompt_text`, the default persona is "You are WREN, a Socratic writing coach."

### Layer 5: Application-Level Output Validation

After `InvokeModel`, `apply_output_guardrail()` (`backend/engine/python/wren_engine/output_guardrail.py`) strips or rejects any ghostwriting-shaped fields from the model's JSON before it is saved. Separately, the `@wren/types` DTO contract bans a `replacementProse` field at compile time and at runtime.

### Defense-in-Depth Summary

```text
ADMIN PROMPT CONFIGURATION          STUDENT DEBRIEF
        │                                   │
        ▼                                   ▼
Ghostwriting validation             Untrusted-data isolation
        │                                   │
        ▼                                   ▼
Bedrock Guardrail                   Model instructions
(PROMPT_ATTACK / MEDIUM)                    │
        │                                   ▼
        ▼                               InvokeModel
Persist configuration                       │
                                            ▼
                              Application-level output validation
                                            │
                                            ▼
                                    Socratic feedback
```

## Runtime Behavior

The Admin service screens prompt text via `assertPromptInjectionFree(text)` in `backend/admin/src/promptGuardrail.ts`. It sends the text to `ApplyGuardrail` with `source: 'INPUT'` and the configured version (`DRAFT`), then acts on the result.

The check runs before the database write on these routes:

| API | Fields screened |
|-----|-----------------|
| `PUT /v1/document-types/{id}/config` | `typePromptText`, `structureDescription`, `restrictionsDescription`, `notesDescription` |
| `PUT /v1/departments/{id}/prompt` | `prompt` (Technical Admin) |

Outcomes:

- **Empty text** — returns without calling Bedrock (nothing to screen).
- **Unconfigured guardrail** — when `PROMPT_GUARDRAIL_ID` is unset, the check fails closed: it throws `PromptGuardrailUnavailableError` (`PROMPT_GUARDRAIL_UNCONFIGURED`) → HTTP 503 with a generic message, and nothing is saved. The only bypass is `PROMPT_GUARDRAIL_SKIP=true` (exact value), intended for local development and unit tests (set in `testing/typescript/jest.setup.ts`). CDK never sets it. Both cases log `{"event":"prompt_guardrail_skipped","reason":"unconfigured"|"dev_flag"}`.
- **Deploy-time check** — `ComputeStack` throws at synth if `promptGuardrailId` is an empty string. In normal deploys the id comes from the CDK-created guardrail, so the Admin Lambda always has it.
- **Guardrail intervenes** — `GUARDRAIL_INTERVENED` throws `PromptInjectionError` (`PROMPT_INJECTION_DETECTED`) → HTTP 400. The save is aborted.
- **Bedrock or IAM error** — the error propagates → HTTP 500. Since the check runs before the write, nothing is saved.

## Monitoring

### What Exists Today

Amazon Bedrock publishes `ApplyGuardrail` metrics (invocations, interventions, latency, errors) to the `AWS/Bedrock` CloudWatch namespace, filterable by guardrail id.

CDK also adds a metric filter on the Admin log group for `prompt_guardrail_skipped` (metric `PromptGuardrailSkipped` in the `{stackPrefix}/Security` namespace) and an alarm, `{stackPrefix}-prompt-guardrail-skipped`, that fires on any occurrence and notifies the alarm SNS topic. In a deployed environment this means the guardrail is unconfigured; check `PROMPT_GUARDRAIL_ID` on the Admin Lambda.

Admin Lambda logs are at `/aws/lambda/wren-dev-admin` (prefix as deployed). Bedrock SDK errors, HTTP 400s with `PROMPT_INJECTION_DETECTED`, and HTTP 500s from `ApplyGuardrail` all land there.

`auditGuardrailOutcome` (`backend/admin/src/auditRecordingService.ts`) writes feedback-generation safety outcomes to the Postgres activity log, under a synthetic `__system__` actor with `objectType: 'FeedbackGeneration'` and verb `guardrail.${outcome}`:

| Outcome | Meaning |
|---------|---------|
| `passed` | Output passed the no-ghostwriting check |
| `violation_rejected` | Output rejected for a no-ghostwriting violation |
| `violation_transformed` | Output stripped/transformed to remove a violation |
| `injection_mitigated` | A prompt-injection mitigation was applied |

`auditGuardrailOutcome` is a general-purpose safety-audit helper (Requirements 11.5 and 38.4). Despite the name, it records application-level feedback-generation outcomes, not individual Bedrock `ApplyGuardrail` calls. `auditPromptEdit` also records a `guardrailOutcome` of `'passed'` or `'rejected'` for prompt edits.

## Cross-References

- [Architecture Deep Dive](./architecture-deep-dive.md) — Overall system architecture including the Feedback Engine and Admin service
- [Deployment Guide](./deployment-guide.md) — Deploying the CDK stacks that create the guardrail and SSM parameters
- [Security Overview](./security-overview.md) — §7 GenAI guardrails in the broader security context
- [Modification Guide](./modification-guide.md) — Changing prompt-attack strength, messaging, or adding policies
