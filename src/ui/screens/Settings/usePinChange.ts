import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isPasskeyRegistered, updatePasskeyPin, removePasskey } from '@/services/passkey'

export type PinChangeStep = 'current' | 'new' | 'confirm'

export interface UsePinChangeOptions {
  onVerifyPin: (pin: string) => Promise<boolean>
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  onPasskeyDesynced?: () => void
}

export function usePinChange({ onVerifyPin, onChangePassword, onPasskeyDesynced }: UsePinChangeOptions) {
  const { t } = useTranslation()

  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<PinChangeStep>('current')
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [isChanging, setIsChanging] = useState(false)

  const clearFields = useCallback(() => {
    setStep('current')
    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setError('')
  }, [])

  const reset = useCallback(() => {
    setIsOpen(false)
    clearFields()
  }, [clearFields])

  const open = useCallback(() => {
    clearFields()
    setIsOpen(true)
  }, [clearFields])

  const handleCurrentPinChange = useCallback((value: string) => {
    setCurrentPin(value)
    setError('')
  }, [])

  const handleNewPinChange = useCallback((value: string) => {
    setNewPin(value)
    setError('')
    if (value.length === 6) {
      setTimeout(() => setStep('confirm'), 200)
    }
  }, [])

  const handleConfirmPinChange = useCallback((value: string) => {
    setConfirmPin(value)
    setError('')
  }, [])

  const handleCurrentPinSubmit = useCallback(async () => {
    if (currentPin.length !== 6) return
    setIsVerifying(true)
    setError('')
    try {
      const valid = await onVerifyPin(currentPin)
      if (valid) {
        setStep('new')
      } else {
        setError(t('settings.wrongPin'))
        setCurrentPin('')
      }
    } catch {
      setError(t('lock.errorOccurred'))
    } finally {
      setIsVerifying(false)
    }
  }, [currentPin, onVerifyPin, t])

  const handlePinChangeSubmit = useCallback(async () => {
    if (newPin !== confirmPin) {
      setError(t('settings.pinChangeError'))
      setConfirmPin('')
      return
    }
    setIsChanging(true)
    setError('')
    try {
      const success = await onChangePassword(currentPin, newPin)
      if (success) {
        // Sync passkey if registered
        if (isPasskeyRegistered()) {
          const pinUpdated = await updatePasskeyPin(newPin)
          if (!pinUpdated) {
            removePasskey()
            onPasskeyDesynced?.()
          }
        }
        reset()
      } else {
        setError(t('settings.wrongCurrentPin'))
        setStep('current')
        setCurrentPin('')
        setNewPin('')
        setConfirmPin('')
      }
    } catch {
      setError(t('lock.errorOccurred'))
    } finally {
      setIsChanging(false)
    }
  }, [newPin, confirmPin, currentPin, onChangePassword, onPasskeyDesynced, reset, t])

  return {
    isOpen,
    step,
    currentPin,
    newPin,
    confirmPin,
    error,
    isVerifying,
    isChanging,
    open,
    close: reset,
    handleCurrentPinChange,
    handleNewPinChange,
    handleConfirmPinChange,
    handleCurrentPinSubmit,
    handlePinChangeSubmit,
  }
}
