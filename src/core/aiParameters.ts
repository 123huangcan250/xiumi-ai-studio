/** Task-controlled fields cannot be overridden by provider-specific extras. Shared with the settings UI. */
export const PROTECTED_AI_PARAMETERS = ['model', 'messages', 'system', 'stream', 'tools', 'tool_choice', 'max_tokens', 'max_completion_tokens', 'temperature', 'reasoning_effort', 'output_config', 'response_format'] as const

export function ignoredExtraParameters(text = ''): string[] {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return PROTECTED_AI_PARAMETERS.filter((key) => Object.hasOwn(value, key))
  } catch { return [] }
}
