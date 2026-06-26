---
title: Lambda Best Practices
inclusion: fileMatch
fileMatchPattern: 'handler/**,**/handlers/**,*.handler.ts,*.handler.py,lambda/**'
---

# AWS Lambda Best Practices

Guidance for authoring AWS Lambda functions. Defaults align with the project tech stack:
**Python 3.12** and **Node.js 22.x** runtimes, packaged via CDK (`NODEJS_22_X` /
container images), with secrets resolved at runtime.

## Function Design

- Keep handlers thin: parse/validate input, delegate to a service/business layer, format
  the response. Put domain logic in `services/`, not in the handler.
- One function, one responsibility. Avoid "router" Lambdas that branch on many event types.
- Make handlers idempotent — events can be delivered more than once. Use idempotency keys
  for writes (e.g. DynamoDB conditional puts) where retries are possible.
- Initialize SDK clients, DB connections, and config **outside** the handler so they are
  reused across warm invocations. Keep the handler body focused on per-event work.
- Treat the handler signature explicitly:
  - Python: `def handler(event, context):`
  - Node/TS: `export const handler = async (event, context) => { ... }`

## Configuration & Secrets

- Never hardcode secrets, endpoints, or account IDs. Pass **secret names** and config via
  environment variables and resolve actual values at runtime from Secrets Manager / SSM
  Parameter Store.
- Cache resolved secrets/parameters in the execution environment (module scope) and
  refresh on a TTL rather than fetching on every invocation.
- Validate required environment variables at cold start and fail fast with a clear error.

## Performance & Cost

- Right-size memory — CPU scales with memory. Tune with Lambda Power Tuning rather than
  guessing.
- Reuse connections: pair RDS access with **RDS Proxy** (TLS required) to avoid connection
  storms; reuse pooled `psycopg`/`postgres` clients across invocations.
- Minimize package/layer size to reduce cold starts. Share heavy dependencies via Lambda
  layers; use container images for large/AI workloads (`public.ecr.aws/lambda/python:3.12`).
- Set a deliberate timeout and reserved/provisioned concurrency for latency-sensitive paths.
- Prefer ARM/Graviton where supported for better price-performance.

## Error Handling & Resilience

- Catch and classify errors; return structured error responses for API-facing functions
  and re-raise for async sources so retries/DLQs engage.
- Configure a **Dead Letter Queue** (SQS/SNS) or Lambda destinations for async invocations.
- Use exponential backoff with jitter for downstream calls; respect downstream throttling.
- Set sensible retry counts on event source mappings; avoid poison-message loops with
  `maxRecordAge` / `bisectBatchOnError` for streams.

## Security

- Apply least-privilege IAM: one scoped role per function, no `*` actions or resources.
  Split shared roles into per-function roles.
- Run data-plane functions in **private/isolated subnets**; reach AWS services via VPC
  interface/gateway endpoints.
- Require TLS to the database (`rds.force_ssl`) and enforce SSL on S3 access.
- Never log secrets, tokens, or PII. Scrub sensitive fields before logging.

## Observability

- Emit **structured (JSON) logs**. On Python, use the **AWS Lambda Powertools** layer for
  logging, metrics, and tracing.
- Add a correlation/request ID to logs and propagate it to downstream calls.
- Enable **X-Ray / OpenTelemetry** tracing for multi-service flows.
- Publish custom business metrics via Powertools/EMF; set CloudWatch alarms on error rate,
  throttles, and duration.
- Set environment-appropriate log retention — do not keep logs indefinitely by default.

## Packaging & Deployment (CDK)

- Use `NodejsFunction` (TS) or `PythonFunction` (Python) so bundling is handled
  consistently; pin the runtime (`NODEJS_22_X`, `PYTHON_3_12`).
- Keep handler source in a `handler/` (or `handlers/`) subdirectory of the defining
  construct, per CDK conventions.
- For container Lambdas, use multi-stage Dockerfiles (builder compiles C extensions, slim
  runtime copies only needed artifacts) and set `PYTHONUNBUFFERED=1`.
- Deploy container updates via `update-function-code`, publish a version, and shift a
  `live` alias so rollback is a single alias move.

## Testing

- Unit-test the service layer independently of the handler. Mock AWS SDK calls.
- Property-based tests: `fast-check` (TS) / Hypothesis (Python) for input-handling logic.
- Add integration tests against real/emulated event payloads; mark `integration`/`slow`
  tests so they can be filtered in automation.
- Aim for >80% coverage on public functions.
