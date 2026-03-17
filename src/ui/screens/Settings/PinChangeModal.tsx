import { useTranslation } from 'react-i18next'
import { Modal, PinInput } from '../../components/common'

export type PinChangeStep = 'current' | 'new' | 'confirm'

export interface PinChangeModalProps {
  isOpen: boolean
  step: PinChangeStep
  currentPin: string
  newPin: string
  confirmPin: string
  pinError: string
  isVerifyingPin: boolean
  isChangingPin: boolean
  onCurrentPinChange: (value: string) => void
  onNewPinChange: (value: string) => void
  onConfirmPinChange: (value: string) => void
  onCurrentPinSubmit: () => void
  onPinChangeSubmit: () => void
  onClose: () => void
}

export function PinChangeModal({
  isOpen,
  step,
  currentPin,
  newPin,
  confirmPin,
  pinError,
  isVerifyingPin,
  isChangingPin,
  onCurrentPinChange,
  onNewPinChange,
  onConfirmPinChange,
  onCurrentPinSubmit,
  onPinChangeSubmit,
  onClose,
}: PinChangeModalProps) {
  const { t } = useTranslation()

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('settings.changePin')}>
      <div className="py-3">
        {step === 'current' && (
          <PinInput
            value={currentPin}
            onChange={onCurrentPinChange}
            label={t('settings.currentPinLabel')}
            error={pinError}
            submitLabel={t('common.next')}
            onSubmit={onCurrentPinSubmit}
            loading={isVerifyingPin}
          />
        )}
        {step === 'new' && (
          <PinInput
            value={newPin}
            onChange={onNewPinChange}
            label={t('settings.newPinLabel')}
          />
        )}
        {step === 'confirm' && (
          <PinInput
            value={confirmPin}
            onChange={onConfirmPinChange}
            label={t('settings.confirmPinLabel')}
            error={pinError}
            submitLabel={t('settings.change')}
            onSubmit={onPinChangeSubmit}
            loading={isChangingPin}
          />
        )}
      </div>
    </Modal>
  )
}
