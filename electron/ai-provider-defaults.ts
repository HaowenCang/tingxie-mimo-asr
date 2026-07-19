export function resolveProviderSystemPrompt(value: unknown, defaultPrompt: string): string {
  return typeof value === 'string' && value.trim() ? value : defaultPrompt
}
