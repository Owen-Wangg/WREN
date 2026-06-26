---
title: API Gateway Best Practices
inclusion: fileMatch
fileMatchPattern: '**/openapi*.yaml,**/openapi*.yml,**/openapi*.json,**/swagger*.yaml,**/swagger*.json,**/*Api*.ts,**/api/**'
---

# API Gateway Best Practices

Guidance for designing and deploying APIs on Amazon API Gateway. Defaults align with
the project tech stack: **REST via API Gateway**, defined **spec-first** from an
**OpenAPI/Swagger** document loaded with `SpecRestApi`, fronted by Cognito auth and a
custom Lambda authorizer.

## API Design

- Default to **REST API Gateway** for request/response APIs. Use **GraphQL (AppSync)**
  for realtime subscriptions/streaming and **event-driven** patterns (EventBridge) for
  async work.
- Use a **regional endpoint** (front with CloudFront when you need edge caching/CDN).
- Design resource-oriented paths (`/users/{userId}/orders`), use HTTP verbs correctly,
  and return standard status codes. Keep paths nouns, not verbs.
- Version the API explicitly (e.g. `/v1/...`) so breaking changes don't disrupt clients.
- Keep payloads consistent — use a shared error envelope and predictable field naming
  (camelCase in JSON).

## Spec-First with OpenAPI

- Treat the **OpenAPI 3.x document as the source of truth**. Define paths, methods,
  request/response schemas, parameters, and security schemes in the spec, then deploy
  with CDK `SpecRestApi` rather than defining routes imperatively.
- Wire integrations in the spec via `x-amazon-apigateway-integration` (typically
  `AWS_PROXY` to Lambda), and request validation via
  `x-amazon-apigateway-request-validator` so malformed requests are rejected at the edge
  before invoking Lambda.
- Define the authorizer in the spec with `x-amazon-apigateway-authorizer` and reference
  it from a `securitySchemes` entry; apply it with `security` on operations.
- Keep the spec in version control next to the API stack and reference it from CDK:

  ```ts
  const api = new apigateway.SpecRestApi(this, `${id}-RestApi`, {
    apiDefinition: apigateway.ApiDefinition.fromAsset(
      path.join(__dirname, "openapi.yaml"),
    ),
    endpointTypes: [apigateway.EndpointType.REGIONAL],
    deployOptions: {
      stageName: environmentName,
      metricsEnabled: true,
      throttlingRateLimit: 100,
      throttlingBurstLimit: 200,
      loggingLevel: apigateway.MethodLoggingLevel.ERROR,
    },
  });
  ```

- Validate the spec in CI (e.g. `spectral lint`, `swagger-cli validate`) so a malformed
  document fails the build before deployment.
- Use OpenAPI `components`/`$ref` to share schemas; avoid duplicating model definitions
  across operations.

## Security

- **Authentication/authorization:** use a **Cognito user pool + identity pool**. Verify
  JWTs with `aws-jwt-verify` in a **custom Lambda authorizer**, and cache authorizer
  results (TTL) to reduce per-request overhead. Disable unauthenticated identities unless
  explicitly required.
- Front the API with **WAF** (managed rule sets + rate limiting) and enforce HTTPS/TLS
  only.
- Validate every request — enable request validation in the spec and validate body,
  query, and path parameters. Never trust client input.
- Apply **least-privilege IAM** on integration roles; scope Lambda invoke permissions to
  the specific functions. Store any third-party credentials in Secrets Manager and read
  at runtime.
- Set **throttling** (account, stage, and per-method) and consider **usage plans + API
  keys** for partner/third-party consumers to protect backends.

## Performance & Reliability

- Tune stage-level **throttling** (rate + burst) and use **method-level** overrides for
  hot or expensive endpoints.
- Enable **caching** at the stage for cacheable GETs where staleness is acceptable; set
  per-method cache TTLs and a cache key from relevant parameters.
- Keep integrations **idempotent** and use `AWS_PROXY` integrations to keep mapping logic
  in code, not in VTL templates, where practical.
- Set deliberate integration timeouts and surface backend throttling as `429` with
  `Retry-After` where possible.

## Observability

- Enable **CloudWatch metrics** (`metricsEnabled: true`) and set **access logging** with
  a structured (JSON) format including request ID, route, status, latency, and integration
  latency.
- Set **execution logging** to `ERROR` by default (raise to `INFO` only when debugging) to
  avoid logging sensitive data.
- Propagate the API Gateway request ID into downstream Lambda logs as a correlation ID and
  enable **X-Ray** tracing for multi-service flows.
- Alarm on `4XXError`, `5XXError`, `Latency` (p99), and `Count` anomalies; enable WAF
  CloudWatch metrics + sampled requests.

## API Documentation

Make the OpenAPI spec do double duty as the API contract and the documentation source.

- **Generate, don't hand-write.** Render human-readable docs directly from the OpenAPI
  document so docs never drift from the implementation:
  - **Redoc** / `redocly build-docs openapi.yaml` for a static HTML reference site.
  - **Swagger UI** for interactive "try it out" exploration during development.
  - **API Gateway export** — `aws apigateway get-export --rest-api-id <id> --stage-name
    <stage> --export-type oas30 openapi.json` to confirm the deployed contract matches the
    source spec.
- Enrich the spec for better docs: meaningful `summary`/`description` on every operation,
  `examples` for requests and responses, `tags` to group endpoints, and documented error
  responses.
- Use API Gateway **documentation parts** (`x-amazon-apigateway-documentation`) when you
  want docs managed alongside the deployed API and exported per stage.
- Publish docs in CI/CD — build the static site on each merge and host it (e.g. S3 +
  CloudFront or Amplify) so the latest contract is always available to consumers.
- Keep a changelog for the API and call out breaking vs. non-breaking changes per version.

## Testing

- Validate the OpenAPI spec in CI (lint + schema validation) and fail the build on errors.
- Contract-test handlers against the spec so request/response shapes stay in sync.
- Add integration tests against a deployed dev stage for auth, validation, throttling, and
  error paths.
- Property-based tests (`fast-check` / Hypothesis) for input-validation and mapping logic.
