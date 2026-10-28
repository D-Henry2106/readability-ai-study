'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { UiIcon } from './UiIcon';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string };
type NotifyInput = Omit<ToastItem, 'id'>;
const ToastContext = createContext<((input: NotifyInput) => void) | null>(null);
let nextToastId = 0;

function ToastCard({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), item.kind === 'error' ? 6500 : 4600);
    return () => window.clearTimeout(timer);
  }, [item.id, item.kind, dismiss]);

  return <div className={`admin-toast admin-toast--${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
    <span className="admin-toast-icon"><UiIcon name={item.kind === 'success' ? 'checkCircle' : item.kind === 'error' ? 'alert' : 'info'} /></span>
    <div className="admin-toast-copy"><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div>
    <button className="admin-toast-dismiss" type="button" onClick={() => dismiss(item.id)} aria-label="Đóng thông báo"><UiIcon name="close" /></button>
  </div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems(current => current.filter(item => item.id !== id)), []);
  const notify = useCallback((input: NotifyInput) => {
    const id = ++nextToastId;
    setItems(current => [...current.slice(-2), { ...input, id }]);
  }, []);
  const value = useMemo(() => notify, [notify]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="admin-toast-viewport" aria-label="Thông báo" aria-live="polite" aria-relevant="additions text">
      {items.map(item => <ToastCard item={item} dismiss={dismiss} key={item.id} />)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast cần ToastProvider.');
  return context;
}
