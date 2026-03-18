import { useTranslation } from 'react-i18next'
import { Modal, PinInput } from '../../components/common'
import type { usePinChange } from './usePinChange'

export type { PinChangeStep } from './usePinChange'

type PinChangeState = ReturnType<typeof usePinChange>

export interface PinChangeModalProps {
  pinChange: PinChangeState
}

export function PinChangeModal({ pinChange }: PinChangeModalProps) {
  const { t } = useTranslation()

  return (
    <Modal isOpen={pinChange.isOpen} onClose={pinChange.close} title={t('settings.changePin')}>
      <div className="py-3">
        {pinChange.step === 'current' && (
          <PinInput
            value={pinChange.currentPin}
            onChange={pinChange.handleCurrentPinChange}
            label={t('settings.currentPinLabel')}
            error={pinChange.error}
            submitLabel={t('common.next')}
            onSubmit={pinChange.handleCurrentPinSubmit}
            loading={pinChange.isVerifying}
          />
        )}
        {pinChange.step === 'new' && (
          <PinInput
            value={pinChange.newPin}
            onChange={pinChange.handleNewPinChange}
            label={t('settings.newPinLabel')}
          />
        )}
        {pinChange.step === 'confirm' && (
          <PinInput
            value={pinChange.confirmPin}
            onChange={pinChange.handleConfirmPinChange}
            label={t('settings.confirmPinLabel')}
            error={pinChange.error}
            submitLabel={t('settings.change')}
            onSubmit={pinChange.handlePinChangeSubmit}
            loading={pinChange.isChanging}
          />
        )}
      </div>
    </Modal>
  )
}
