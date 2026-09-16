const REDACTED = "[REDACTED]";

export function redactText(value: string, secrets: readonly (string | undefined)[]): string {
  return secrets
    .filter((secret): secret is string => typeof secret === "string" && secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((text, secret) => text.split(secret).join(REDACTED), value);
}

export function withoutSecretEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env };
  delete clean.WREN_GITHUB_TOKEN;
  return clean;
}
