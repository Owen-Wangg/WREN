import { CommandError, runCommand, type CommandResult, type CommandSpec } from "./runner.js";

export interface AwsIdentity {
  readonly Account: string;
  readonly Arn: string;
  readonly UserId: string;
}

export interface AwsCommandRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

function parseJson<T>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${source} returned invalid JSON.`);
  }
}

export class AwsCli {
  private readonly runner: AwsCommandRunner;

  public constructor(
    private readonly region: string,
    private readonly profile?: string,
    runner: AwsCommandRunner = { run: runCommand },
  ) {
    this.runner = runner;
  }

  private args(args: readonly string[], region = this.region): readonly string[] {
    return [
      ...args,
      "--region",
      region,
      ...(this.profile ? ["--profile", this.profile] : []),
      "--output",
      "json",
      "--no-cli-pager",
    ];
  }

  public async command(args: readonly string[], region = this.region, secrets: readonly string[] = []): Promise<CommandResult> {
    return this.runner.run({ executable: "aws", args: this.args(args, region), secrets });
  }

  public async text(args: readonly string[], region = this.region): Promise<string> {
    const result = await this.command(args, region);
    return result.stdout.trim();
  }

  public async json<T>(args: readonly string[], region = this.region): Promise<T> {
    const result = await this.command(args, region);
    return parseJson<T>(result.stdout, `aws ${args.slice(0, 2).join(" ")}`);
  }

  public async tryJson<T>(args: readonly string[], region = this.region): Promise<T | undefined> {
    try {
      return await this.json<T>(args, region);
    } catch (error) {
      if (error instanceof CommandError) {
        const output = `${error.result.stderr}\n${error.result.stdout}`;
        if (/does not exist|not found|ResourceNotFoundException|RepositoryNotFoundException|RepositoryPolicyNotFoundException/i.test(output)) {
          return undefined;
        }
      }
      throw error;
    }
  }

  public identity(): Promise<AwsIdentity> {
    return this.json<AwsIdentity>(["sts", "get-caller-identity"]);
  }
}
