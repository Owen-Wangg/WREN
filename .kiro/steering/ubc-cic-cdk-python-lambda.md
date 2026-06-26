---
title: CDK Python Lambda Patterns
inclusion: auto
name: cdk-python-lambda
description: Patterns for CDK stacks deploying Python Lambda functions with database access.
---

# CDK + Python Lambda Patterns

## Project Layout
```
src/
├── stacks/
│   └── ApiStack.ts
├── constructs/
│   └── UserService/
│       ├── UserService.ts
│       └── handler/
│           ├── requirements.txt
│           ├── index.py
│           └── models.py
└── app.ts
```

## CDK Construct for Python Lambda
- Use `PythonFunction` from `@aws-cdk/aws-lambda-python-alpha`
- Bundle dependencies from `handler/requirements.txt` automatically
- Set `runtime: Runtime.PYTHON_3_12`
- Use Powertools for AWS Lambda (Python) for logging, tracing, metrics
- Grant least-privilege IAM permissions using `grantRead()` / `grantWrite()`

## Database Access from Lambda
- Store connection strings in AWS Secrets Manager
- Use RDS Proxy for connection pooling with Aurora/PostgreSQL
- For DynamoDB, use `Table.grantReadWriteData(lambdaFunction)`
- Set environment variables for table names and endpoint URLs
- Use `aws-lambda-powertools` `idempotency` utility for safe retries

## Environment Separation
- Each environment (dev, staging, prod) gets its own stack instance
- Pass database identifiers as construct props, never hardcode ARNs
- Use CDK context or SSM lookups only for account/region resolution
