import { useEffect } from 'react';
import { useEditorSettingsStore } from '../../../store/editorSettings';

const ENABLED_OPTIONS = {
  includeInlayParameterNameHints: 'all',
  includeInlayParameterNameHintsWhenArgumentMatchesName: true,
  includeInlayFunctionParameterTypeHints: true,
  includeInlayVariableTypeHints: true,
  includeInlayPropertyDeclarationTypeHints: true,
  includeInlayFunctionLikeReturnTypeHints: true,
  includeInlayEnumMemberValueHints: true,
} as const;

const DISABLED_OPTIONS = {
  includeInlayParameterNameHints: 'none',
} as const;


export function applyInlayHintsOptions(monaco: any, enabled: boolean): void {
  const options = enabled ? ENABLED_OPTIONS : DISABLED_OPTIONS;
  monaco.languages.typescript?.typescriptDefaults?.setInlayHintsOptions(options);
  monaco.languages.typescript?.javascriptDefaults?.setInlayHintsOptions(options);
}

export function useInlayHintsSync(monaco: any): void {
  const inlayHintsEnabled = useEditorSettingsStore((s) => s.inlayHintsEnabled);

  useEffect(() => {
    if (!monaco) return;
    applyInlayHintsOptions(monaco, inlayHintsEnabled);
  }, [monaco, inlayHintsEnabled]);
}
