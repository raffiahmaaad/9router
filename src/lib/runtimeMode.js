export function isHostedMode() {
  return process.env.HOSTED_MODE === "true";
}

export function requireHostedEnv(name) {
  const value = process.env[name];
  if (!value) {
    const error = new Error(`Missing hosted mode config: ${name}`);
    error.code = "MISSING_HOSTED_CONFIG";
    throw error;
  }
  return value;
}
