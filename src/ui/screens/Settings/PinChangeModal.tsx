import { useTranslation } from 'react-i18next'
import { Modal, Button, PinInput } from '../../components/common'

export type PinChangeStep = 'current' | 'new' | 'confirm'

export interface PinChangeModalProps {
  isOpen: boolean
  step: PinChangeStep
  currentPin: string
  newPin: string
  confirmPin: string
  pinError: string
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
          <>
            <PinInput value={currentPin} onChange={onCurrentPinChange} length={10} label={t('settings.currentPinLabel')} error={pinError} />
            <Button variant="primary" size="lg" onClick={onCurrentPinSubmit} disabled={currentPin.length < 1} className="w-full mt-6">
              {t('common.next')}
            </Button>
          </>
        )}
        {step === 'new' && (
          <PinInput value={newPin} onChange={onNewPinChange} length={6} label={t('settings.newPinLabel')} />
        )}
        {step === 'confirm' && (
          <>
            <PinInput value={confirmPin} onChange={onConfirmPinChange} length={6} label={t('settings.confirmPinLabel')} error={pinError} />
            <Button variant="primary" size="lg" onClick={onPinChangeSubmit} loading={isChangingPin} disabled={confirmPin.length !== 6} className="w-full mt-6">
              {t('settings.change')}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}
