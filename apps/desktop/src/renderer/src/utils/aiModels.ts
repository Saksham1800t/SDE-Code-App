export const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Claude',
  ollama: 'Ollama',
  'lm-studio': 'LM Studio',
  'custom-openai': 'Custom API',
};

export const getProviderLabel = (provider: string): string => PROVIDER_LABEL[provider] || provider;

export const getModelsForProvider = (provider: string): string[] => {
  switch (provider) {
    case 'gemini':
      return ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];
    case 'openai':
      return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    case 'anthropic':
      return ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'];
    default:
      return [];
  }
};

export const getDefaultModelForProvider = (provider: string): string => {
  const presets = getModelsForProvider(provider);
  if (presets.length > 0) return presets[0];
  if (provider === 'ollama') return 'llama3';
  if (provider === 'lm-studio') return 'local-model';
  return 'gpt-4o';
};
