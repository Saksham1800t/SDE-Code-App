import { create } from 'zustand';
import { AlertState } from '../types/alerts';

export const useAlertStore = create<AlertState>((set) => ({
  currentAlert: null,
  showAlert: (message, title = 'SDE Code', onConfirm) => {
    set({
      currentAlert: {
        id: Math.random().toString(),
        message,
        title,
        onConfirm
      }
    });
  },
  closeAlert: () => {
    const current = useAlertStore.getState().currentAlert;
    if (current?.onConfirm) {
      try {
        current.onConfirm();
      } catch (e) {
        console.error(e);
      }
    }
    set({ currentAlert: null });
  }
}));

export const customAlert = (message: string, title?: string) => {
  useAlertStore.getState().showAlert(message, title);
};
