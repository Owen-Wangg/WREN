---
title: AWS Well-Architected Best Practices
inclusion: always
---

# AWS Well-Architected Best Practices

Apply the AWS Well-Architected Framework as the default lens for designing,
reviewing, and operating workloads. The framework is organized into six pillars.
Treat the guidance below as the baseline; when a pillar's recommendation conflicts
with a concrete project requirement, favor the project's actual needs and document
the tradeoff.

## General Design Principles

- Stop guessing capacity — scale automatically based on demand rather than
  provisioning for peak.
- Test systems at production scale, then tear down to control cost.
- Automate to make architectural experimentation easier (IaC, CI/CD, repeatable
  environments).
- Allow for evolutionary architectures — favor decisions that are reversible and
  components that can be replaced.
- Drive architectures using data; let measured behavior inform changes.
- Improve through game days — simulate failures and load to validate assumptions.

## 1. Operational Excellence

Run and monitor systems to deliver business value and continually improve.

- Perform operations as code — define infrastructure, deployments, and runbooks
  with IaC (AWS CDK v2) and automation, not manual console steps.
- Make frequent, small, reversible changes through CI/CD (CodePipeline + CodeBuild)
  so failures have limited blast radius.
- Anticipate failure: run pre-mortems and game days, define and test runbooks and
  playbooks for known failure modes.
- Instrument everything — emit structured logs, metrics, and traces (CloudWatch,
  X-Ray / OpenTelemetry) and define operational KPIs.
- Capture lessons learned in postmortems and feed them back into the design.

## 2. Security

Protect data, systems, and assets while delivering business value.

- Implement a strong identity foundation — least-privilege IAM, one scoped role per
  function/service, no `*` actions or resources, and short-lived credentials.
- Enable traceability — turn on CloudTrail, VPC flow logs, WAF logging, and RDS
  enhanced monitoring; centralize and retain logs appropriately.
- Apply security at all layers — VPC segmentation (public / private-with-egress /
  isolated subnets), security groups, WAF, and Bedrock Guardrails.
- Protect data in transit and at rest — enforce TLS everywhere (`rds.force_ssl`,
  S3 `enforceSSL`), encrypt with KMS, and block public access on S3.
- Keep people away from data — automate access through pipelines and tooling rather
  than direct human access to production data.
- Manage secrets centrally — store credentials in Secrets Manager and shared config
  in SSM Parameter Store; never hardcode secrets.
- Prepare for security events — define an incident response plan and run simulations.

## 3. Reliability

Ensure a workload performs its intended function correctly and consistently.

- Automatically recover from failure — monitor KPIs and trigger automated remediation
  when thresholds are breached.
- Test recovery procedures — use IaC to recreate environments and rehearse failure
  scenarios, not just success paths.
- Scale horizontally to increase aggregate availability; replace one large resource
  with multiple smaller ones to reduce single points of failure.
- Stop guessing capacity — use auto scaling and serverless (Lambda, Fargate) to match
  supply to demand.
- Manage change through automation — version infrastructure and apply changes via
  pipelines.
- Design for fault isolation — use multiple Availability Zones, DLQs for async work,
  idempotent handlers, retries with exponential backoff and jitter, and graceful
  degradation.
- Define and track RTO/RPO; back up critical data (RDS automated backups, S3
  versioning + lifecycle) and test restores.

## 4. Performance Efficiency

Use computing resources efficiently as demand and technology change.

- Use the right resource for the job — Lambda for event-driven work, Fargate for
  long-lived/stateful services, RDS PostgreSQL + RDS Proxy for relational data,
  DynamoDB for key-value/session state.
- Go serverless first to remove operational overhead and scale to demand.
- Right-size and tune — match compute to workload (Lambda Power Tuning), prefer
  ARM/Graviton for price-performance, and reuse connections/clients across warm
  invocations.
- Experiment frequently — managed services make it cheap to trial alternatives.
- Use caching (CloudFront, in-memory, parameter/secret caching with TTL) to reduce
  latency and load.
- Establish performance baselines and monitor against them (CloudWatch metrics,
  alarms on latency, throttles, and duration).

## 5. Cost Optimization

Deliver business value at the lowest price point.

- Adopt a consumption model — pay for what you use; scale down or to zero in
  non-production (serverless, scheduled stop/start).
- Measure overall efficiency — tag every stack and resource for cost allocation
  (`cdk.Tags.of(stack).add("Project", StackPrefix)`) and review Cost Explorer.
- Stop spending on undifferentiated heavy lifting — prefer managed services over
  self-managed infrastructure.
- Right-size continuously and clean up unused resources (idle RDS, orphaned volumes,
  old snapshots, unattached IPs).
- Set S3 lifecycle rules and log retention deliberately rather than storing data
  indefinitely.
- Use the most cost-effective pricing and compute options (Graviton, Savings Plans,
  Spot for fault-tolerant work).

## 6. Sustainability

Minimize the environmental impact of running cloud workloads.

- Maximize utilization — right-size and consolidate to reduce idle capacity; scale to
  zero where possible.
- Prefer managed and serverless services so AWS optimizes the underlying fleet.
- Choose efficient compute — ARM/Graviton processors deliver more performance per watt.
- Reduce data movement and storage footprint — compress, set lifecycle/retention
  policies, and avoid duplicate datasets.
- Select Regions thoughtfully and align demand with available capacity.

## Applying the Framework

- Run a Well-Architected Review for significant new workloads and at major milestones;
  capture high-risk issues (HRIs) and remediation plans.
- Treat pillar tradeoffs explicitly — document where, for example, reliability
  redundancy is accepted at higher cost, or performance is traded for sustainability.
- Re-evaluate periodically; architectures should evolve as requirements and AWS
  capabilities change.
