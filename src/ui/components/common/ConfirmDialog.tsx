import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Modal } from './Modal'
import { Button } from './Button'

export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  icon?: ReactNode
  iconColor?: 'primary' | 'warning' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'destructive'
  loading?: boolean
}

const iconBgColors = {
  primary: 'bg-foreground/[0.06]',
  warning: 'bg-accent-warning/[0.08]',
  danger: 'bg-accent-danger/[0.08]',
}

const iconTextColors = {
  primary: 'text-foreground',
  warning: 'text-accent-warning',
  danger: 'text-accent-danger',
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  icon,
  iconColor = 'danger',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} showCloseButton={false}>
      <div className="flex flex-col items-center text-center pt-2 pb-1">
        {icon && (
          <div className={cn(
            'w-14 h-14 rounded-[13px] flex items-center justify-center mb-4',
            iconBgColors[iconColor],
          )}>
            <div className={iconTextColors[iconColor]}>{icon}</div>
          </div>
        )}

        <h3 className="text-heading-md text-foreground">{title}</h3>

        {description && (
          <p className="text-body text-foreground-muted mt-1.5 max-w-[280px]">
            {description}
          </p>
        )}

        <div className="flex gap-2 w-full mt-6">
          <Button
            variant="secondary"
            size="lg"
            onClick={onClose}
            className="flex-1"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            size="lg"
            onClick={onConfirm}
            loading={loading}
            className="flex-1"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
