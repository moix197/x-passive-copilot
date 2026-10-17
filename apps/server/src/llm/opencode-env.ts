export const GEMINI_KEY_VAR = 'GEMINI_API_KEY';
// The env var opencode's built-in `google` provider reads.
const GOOGLE_KEY_VAR = 'GOOGLE_GENERATIVE_AI_API_KEY';

/** Env for the opencode child: the user's GEMINI_API_KEY becomes the google provider's var. */
export function opencodeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  const key = copy[GEMINI_KEY_VAR]?.trim();
  delete copy[GEMINI_KEY_VAR];
  if (key) copy[GOOGLE_KEY_VAR] = key;
  return copy;
}

export function redactKey(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env[GEMINI_KEY_VAR]?.trim();
  return key ? text.split(key).join('[redacted]') : text;
}

export function isGoogleModel(model: string): boolean {
  return model.startsWith('google/');
}

export function hasGeminiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[GEMINI_KEY_VAR]?.trim());
}
