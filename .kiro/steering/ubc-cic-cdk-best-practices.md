---
title: CDK Best Practices
inclusion: always
---

# CDK Best Practices

## Basics
- Use projen for project initialization and file management
- Use the latest version of the CDK: https://github.com/aws/aws-cdk/releases
- Use cdk-iam-floyd for IAM policy generation
- Additional CDK apps should have a projen task with prefix `cdk:` (e.g. `cdk:iam-roles`)

## Structure
- All files in `src/**` directory
- Applications in `src/`
- Stacks in `src/stacks/**`
- Constructs in `src/constructs/**`
- Stages in `src/stages/**`
- Lambda function handlers in a sub-directory of the defining construct, called `handler`
- PascalCasing for filenames (e.g. `SomeConstruct.ts`)
- Each custom construct resides in its own file named the same as the construct

## Apps
- SHOULD contain distinct stack/stage instances for each environment
- SHOULD provide each stack/stage with account/region specific values
- Context SHOULD NOT be used for anything

## Stacks
- SHOULD be responsible for importing resources (`Vpc.fromLookup()`, `Bucket.fromBucketName()`, etc.)
- SHOULD be responsible for instantiating constructs

## Constructs
- SHOULD save the incoming constructor props as a private field
- SHOULD create all resources in protected methods, not in the constructor
- SHOULD NOT import resources (e.g. `Vpc.fromLookup()`)
- SHOULD be passed concrete objects representing resources
- Properties representing resource identifiers should use template literal types (e.g. `vpc-${string}`)

## Tests
- All tests in the `test/` directory
- Tests should match construct names (e.g. `SomeConstruct.test.ts`)
- Use fine-grained assertions for constructs
- Use snapshot tests for stacks
- Mock `Code.fromAsset` and `ContainerImage.fromAsset` calls

## Lambda Functions
- Use `NodejsFunction` or `PythonFunction` whenever possible
