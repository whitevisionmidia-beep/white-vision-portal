let runtimeApiKey: string | undefined;

export function getGeminiApiKey(): string | undefined {
  return runtimeApiKey || process.env.GEMINI_API_KEY;
}

export function setGeminiApiKey(apiKey: string): void {
  runtimeApiKey = apiKey;
}

export function geminiApiKeyStatus(): "ambiente" | "memoria" | "ausente" {
  if (runtimeApiKey) return "memoria";
  if (process.env.GEMINI_API_KEY) return "ambiente";
  return "ausente";
}
