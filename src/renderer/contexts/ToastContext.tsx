import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { cn } from '../lib/utils';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const TOAST_ICONS = {
  success: <CheckCircle className="w-5 h-5 text-green-400" />,
  error: <XCircle className="w-5 h-5 text-red-400" />,
  warning: <AlertCircle className="w-5 h-5 text-yellow-400" />,
  info: <Info className="w-5 h-5 text-blue-400" />,
};

const TOAST_STYLES = {
  success: 'border-green-500/30 bg-green-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  warning: 'border-yellow-500/30 bg-yellow-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idCounter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = ++idCounter.current;
    setToasts(prev => [...prev, { id, message, type }]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast, index) => (
          <div
            key={toast.id}
            className={cn(
              'glass rounded-lg px-4 py-3 shadow-xl flex items-center gap-3 min-w-[280px] max-w-[400px] animate-fade-in pointer-events-auto',
              TOAST_STYLES[toast.type]
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {TOAST_ICONS[toast.type]}
            <p className="text-sm text-text-primary flex-1">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
