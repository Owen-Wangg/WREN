import path from "node:path";
import { parseDeploymentConfig } from "./operations/config.js";
import { ActionRequiredError } from "./operations/errors.js";
import { UndeployWorkflow } from "./operations/undeployWorkflow.js";

export async function main(): Promise<void> {
  const config = parseDeploymentConfig(process.env, "undeploy");
  const repoRoot = path.resolve(__dirname, "../..");
  console.log(`[wren] Teardown target: ${config.stackPrefix} in ${config.region}`);
  await new UndeployWorkflow(config, repoRoot).run();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ActionRequiredError ? error.exitCode : 1;
  });
}
