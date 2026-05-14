import { existsSync, readFileSync } from "node:fs";

export function loadDotEnv(path = ".env") {
  if (!existsSync(path)) {
    return;
  }

  const values = parseDotEnv(readFileSync(path, "utf8"));

  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value;
  }
}

export function parseDotEnv(contents: string) {
  return contents.split(/\r?\n/).reduce<Record<string, string>>((env, line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return env;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return env;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      return env;
    }

    env[key] = unquoteEnvValue(rawValue);
    return env;
  }, {});
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
