import {
  buildResolveContext,
  extractBoundaryPolicy,
  extractDeployRolePolicy,
  type CfnTemplate,
} from "../../scripts/extractDeployRolePolicy.js";
import type { PolicyDocument, PolicyStatement } from "./policyEval.js";
import { synthCicd, synthCompute, type CfnResource } from "./cicdSynth.js";

export interface PolicyFixtures {
  readonly prefix: string;
  readonly account: string;
  readonly region: string;
  readonly boundaryArn: string;
  readonly ownedRolePrefix: string;
  readonly cicdJson: ReturnType<typeof synthCicd>["json"];
  readonly computeJson: ReturnType<typeof synthCompute>["json"];
  readonly deployPolicy: PolicyDocument;
  readonly boundaryPolicy: PolicyDocument;
}

let cache: PolicyFixtures | undefined;

export function asArray<T>(value: T | readonly T[]): readonly T[] {
  return Array.isArray(value) ? value : [value as T];
}

export function statements(document: PolicyDocument): readonly PolicyStatement[] {
  return asArray(document.Statement);
}

export function policyFixtures(): PolicyFixtures {
  if (cache !== undefined) return cache;
  const cicd = synthCicd();
  const compute = synthCompute();
  const { stackPrefix: prefix } = cicd.config;
  const account = cicd.config.env.account;
  const region = cicd.config.env.region;
  if (account === undefined || region === undefined) throw new Error("Test environment must be resolved");

  const template = cicd.json as CfnTemplate;
  const context = buildResolveContext(template, {
    account,
    region,
    partition: "aws",
    stackName: `${prefix}-Cicd`,
    urlSuffix: "amazonaws.com",
  });
  const boundary = Object.values(cicd.json.Resources).find(
    (resource: CfnResource) => resource.Type === "AWS::IAM::ManagedPolicy",
  );
  const boundaryName = boundary?.Properties?.ManagedPolicyName;
  if (typeof boundaryName !== "string") throw new Error("Compute boundary managed policy not found");

  cache = {
    prefix,
    account,
    region,
    boundaryArn: `arn:aws:iam::${account}:policy/${boundaryName}`,
    ownedRolePrefix: `arn:aws:iam::${account}:role/${prefix}-Compute-*`,
    cicdJson: cicd.json,
    computeJson: compute.json,
    deployPolicy: extractDeployRolePolicy(template, prefix, context) as unknown as PolicyDocument,
    boundaryPolicy: extractBoundaryPolicy(template, prefix, context) as unknown as PolicyDocument,
  };
  return cache;
}
