export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the "danger" variant, for destructive actions. */
  danger?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  id: string;
  message: string;
  resolve: (result: boolean) => void;
}

export interface ConfirmState {
  currentConfirm: ConfirmRequest | null;
  showConfirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (result: boolean) => void;
}
