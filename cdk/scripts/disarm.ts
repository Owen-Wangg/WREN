import path from "node:path";
import { parseDeploymentConfig } from "./operations/config.js";
import { DeployWorkflow } from "./operations/deployWorkflow.js";
import { ActionRequiredError } from "./operations/errors.js";

export async function main(): Promise<void> {
  const config = parseDeploymentConfig();
  const repoRoot = path.resolve(__dirname, "../..");
  console.log(`[wren] Disarm target: ${config.stackPrefix} in ${config.region}`);
  await new DeployWorkflow(config, repoRoot).disarmAdministratorBootstrap();
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof ActionRequiredError ? error.exitCode : 1;
  });
}
