export interface PromptOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface PromptRequest extends PromptOptions {
  id: string;
  message: string;
  resolve: (result: string | null) => void;
}

export interface PromptState {
  currentPrompt: PromptRequest | null;
  showPrompt: (message: string, options?: PromptOptions) => Promise<string | null>;
  resolvePrompt: (result: string | null) => void;
}
