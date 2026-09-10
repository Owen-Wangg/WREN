export const DEPLOY_STAGES = [
  "preflight",
  "bedrock",
  "bootstrap-data-region",
  "bootstrap-us-east-1",
  "prerequisites",
  "feedback-image",
  "foundations",
  "application",
  "amplify",
  "administrator",
  "smoke",
  "pipeline",
] as const;

export type DeployStage = (typeof DEPLOY_STAGES)[number];

export const SAFE_UNDEPLOY_ORDER = [
  "Amplify",
  "CloudFrontWaf",
  "Observability",
  "Api",
  "Compute",
] as const;

export function pendingStages(completed: ReadonlySet<string>): readonly DeployStage[] {
  return DEPLOY_STAGES.filter((stage) => !completed.has(stage));
}
