import type { Model, Provider } from "../shared/protocol";

export const defaultModels: Record<Provider, string> = {
  openai: "gpt-4.1",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-pro",
  llama: "Llama-4-Maverick-17B-128E-Instruct-FP8",
  meta: "muse-spark-1.3",
};

export function modelFor(provider: Provider): Model {
  return { provider, model: defaultModels[provider] };
}

export function selectConfiguredModel(
  current: Model,
  configured: Record<Provider, boolean>,
): Model {
  if (configured[current.provider]) return current;
  if (configured.meta) return modelFor("meta");
  const available = (Object.keys(defaultModels) as Provider[]).filter(
    (provider) => configured[provider],
  );
  return available.length === 1 && available[0]
    ? modelFor(available[0])
    : current;
}
