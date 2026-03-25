import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Toast as ToastType } from '@/store'

export interface ToastProps {
  toast: ToastType
  onDismiss: (id: string) => void
}

const variantStyles = {
  success: 'bg-accent-success text-white',
  error: 'bg-accent-danger text-white',
  info: 'bg-accent-primary text-white',
  warning: 'bg-accent-warning text-background',
}

const icons = {
  success: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  warning: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    // Trigger enter animation
    const showTimer = setTimeout(() => setIsVisible(true), 10)

    // Auto dismiss
    const dismissTimer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onDismiss(toast.id), 200)
    }, toast.duration || 3000)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(dismissTimer)
    }
  }, [toast.id, toast.duration, onDismiss])

  const handleDismiss = () => {
    setIsVisible(false)
    setTimeout(() => onDismiss(toast.id), 200)
  }

  const handleClick = () => {
    if (toast.onAction) {
      toast.onAction()
      handleDismiss()
    }
  }

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg
        transition-all duration-200
        ${variantStyles[toast.type]}
        ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}
        ${toast.onAction ? 'cursor-pointer active:scale-[0.98]' : ''}
      `}
      role="alert"
      onClick={handleClick}
    >
      <span className="flex-shrink-0">{icons[toast.type]}</span>
      <p className="flex-1 text-caption font-medium whitespace-pre-line">{toast.message}</p>
      <button
        onClick={(e) => { e.stopPropagation(); handleDismiss() }}
        className="flex-shrink-0 p-1 rounded hover:bg-white/20 transition-all active:scale-95"
        aria-label={t('common.close')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
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
    <div className="fixed left-4 right-4 z-[110] flex flex-col gap-2 pointer-events-none" style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}
