export class ActionRequiredError extends Error {
  public readonly exitCode = 3;

  public constructor(message: string) {
    super(message);
    this.name = "ActionRequiredError";
  }
}
