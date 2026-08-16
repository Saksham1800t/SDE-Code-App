export interface AlertMessage {
  id: string;
  message: string;
  title?: string;
  onConfirm?: () => void;
}

export interface AlertState {
  currentAlert: AlertMessage | null;
  showAlert: (message: string, title?: string, onConfirm?: () => void) => void;
  closeAlert: () => void;
}
