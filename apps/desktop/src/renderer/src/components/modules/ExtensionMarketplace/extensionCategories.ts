export const EXTENSION_CATEGORIES = ['Snippets', 'Language Support', 'Productivity', 'Other'] as const;
export type ExtensionCategory = typeof EXTENSION_CATEGORIES[number];
