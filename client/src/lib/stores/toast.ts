import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  duration: number;
}

let nextId = 0;

export const toasts = writable<Toast[]>([]);

export function addToast(message: string, type: Toast['type'] = 'info', duration = 4000) {
  const id = nextId++;
  toasts.update((t) => [...t, { id, message, type, duration }]);
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
  return id;
}

export function removeToast(id: number) {
  toasts.update((t) => t.filter((toast) => toast.id !== id));
}

export function toast(message: string) {
  return addToast(message, 'info');
}
toast.success = (message: string) => addToast(message, 'success');
toast.error = (message: string) => addToast(message, 'error', 6000);
toast.warning = (message: string) => addToast(message, 'warning', 5000);

// Confirm dialog state
export interface ConfirmState {
  message: string;
  title?: string;
  confirmLabel?: string;
  dangerAction?: boolean;
  resolve: (confirmed: boolean) => void;
}

export const confirmDialog = writable<ConfirmState | null>(null);

export function confirm(
  message: string,
  options?: { title?: string; confirmLabel?: string; dangerAction?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    confirmDialog.set({ message, resolve, ...options });
  });
}
