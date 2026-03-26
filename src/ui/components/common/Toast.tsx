import { useEffect, useState } from 'react'
import type { Toast as ToastType } from '@/store'

export interface ToastProps {
  toast: ToastType
  onDismiss: (id: string) => void
}

const icons = {
  success: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const showTimer = setTimeout(() => setIsVisible(true), 10)
    const dismissTimer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onDismiss(toast.id), 300)
    }, toast.duration || 2500)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(dismissTimer)
    }
  }, [toast.id, toast.duration, onDismiss])

  const handleClick = () => {
    if (toast.onAction) {
      toast.onAction()
    }
    setIsVisible(false)
    setTimeout(() => onDismiss(toast.id), 300)
  }

  return (
    <div
      className={`
        inline-flex items-center gap-2.5 px-5 py-3 rounded-full
        bg-white text-foreground shadow-[0_4px_24px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.08)]
        transition-all duration-300 ease-out
        ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-3 scale-95'}
        ${toast.onAction ? 'cursor-pointer active:scale-[0.97]' : ''}
      `}
      role="alert"
      onClick={handleClick}
    >
      <span className="shrink-0 opacity-90">{icons[toast.type]}</span>
      <p className="text-caption font-medium whitespace-pre-line">{toast.message}</p>
    </div>
  )
}

export interface ToastContainerProps {
  toasts: ToastType[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col items-center gap-2 pointer-events-none"
      style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}
