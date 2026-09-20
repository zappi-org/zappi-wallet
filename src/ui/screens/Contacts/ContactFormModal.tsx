import { detectAddressType } from '@/core/types/contact'
import { useChatViewport } from '@/ui/hooks/use-chat-viewport'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'
import { npubDecode, nprofileDecode } from '@/core/domain/nostr-address'
import { useState, useCallback } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/ui/components/common'
import { Button } from '@/ui/components/common/Button'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import type { Contact } from '@/core/types'
import type { ContactAddressType } from '@/core/types/contact'
import { LIMITS } from '@/core/constants'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'


interface ContactFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; address: string }) => void | Promise<void>
  contact?: Contact | null
  initialAddress?: string
}

type VerifyStatus = 'idle' | 'verifying' | 'valid' | 'invalid'

type VerifyErrorCode =
  | 'invalidFormat'
  | 'notReachable'
  | 'invalidNpub'

type AddressVerifier = {
  resolve(address: string): Promise<unknown>
}

async function verifyAddress(
  address: string,
  type: ContactAddressType,
  addressResolver: AddressVerifier
): Promise<{ valid: boolean; errorCode?: VerifyErrorCode }> {
  if (type === 'lightning') {
    // Simple format check: must contain @ and .
    if (!address.includes('@') || !address.includes('.')) {
      return { valid: false, errorCode: 'invalidFormat' }
    }
    try {
      await addressResolver.resolve(address)
      return { valid: true }
    } catch {
      return { valid: false, errorCode: 'notReachable' }
    }
  }

  if (type === 'npub') {
    try {
      if (address.startsWith('nprofile1')) nprofileDecode(address)
      else npubDecode(address)
      return { valid: true }
    } catch {
      return { valid: false, errorCode: 'invalidNpub' }
    }
  }

  // custom type — no verification
  return { valid: true }
}

export function ContactFormModal({
  isOpen,
  onClose,
  onSave,
  contact,
  initialAddress,
}: ContactFormModalProps) {
  const { t } = useTranslation()
  const resetKey = `${isOpen}-${contact?.id ?? 'new'}`
  const top = useIsActivityTop()
  const viewport = useChatViewport(isOpen && top)

  return (
    <Modal
      isOpen={isOpen && top}
      viewportRef={viewport}
      onClose={onClose}
      title={contact ? t('contacts.editContact') : t('contacts.addContact')}
    >
      <ContactFormInner
        key={resetKey}
        initialAddress={initialAddress}
        contact={contact}
        onSave={onSave}
        onClose={onClose}
      />
    </Modal>
  )
}

function ContactFormInner({
  contact,
  onSave,
  onClose,
  initialAddress,
}: {
  initialAddress?: string
  contact?: Contact | null
  onSave: ContactFormModalProps['onSave']
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { addressResolver } = useServiceRegistry()
  const [name, setName] = useState(contact?.name || '')
  const [address, setAddress] = useState(
    contact?.address || initialAddress || ''
  )
  const [error, setError] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [showScanner, setShowScanner] = useState(false)

  const isEdit = !!contact

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim()
    const trimmedAddress = address.trim().replace(/^nostr:/i, '')

    if (!trimmedName) {
      setError(t('contacts.nameRequired'))
      return
    }
    if (!trimmedAddress) {
      setError(t('contacts.addressRequired'))
      return
    }

    const addrType = detectAddressType(trimmedAddress)

    if (trimmedAddress && addrType !== 'lightning' && addrType !== 'npub') {
      setError(t('contacts.onlyLightningOrNpub'))
      return
    }

    setVerifyStatus('verifying')
    setError('')
    const result = await verifyAddress(trimmedAddress, addrType, addressResolver)
    if (!result.valid) {
      setVerifyStatus('invalid')
      const errorKey = result.errorCode
        ? (`contacts.verify.${result.errorCode}` as const)
        : 'contacts.verificationFailed'
      setError(t(errorKey))
      return
    }
    try {
      await onSave({
        name: trimmedName,
        address: trimmedAddress,
      })
      setVerifyStatus('valid')
      onClose()
    } catch {
      setVerifyStatus('invalid')
      setError(t('chat.saveFailed'))
    }
  }, [name, address, onSave, onClose, t, addressResolver])

  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    const trimmed = result.trim()
    if (trimmed) {
      setAddress(trimmed.replace(/^nostr:/i, ''))
      setError('')
      setVerifyStatus('idle')
    }
  }, [])

  return (
    <div className="space-y-5 py-2">
      {/* Name */}
      <div>
        <p className="text-caption font-medium text-foreground-muted mb-1">
          {t('contacts.name')}{' '}
          <span className="text-overline text-foreground-muted/50 ml-1">
            {name.length}/{LIMITS.MAX_CONTACT_NAME_LENGTH}
          </span>
        </p>
        <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, LIMITS.MAX_CONTACT_NAME_LENGTH))
              setError('')
            }}
            placeholder={t('contacts.namePlaceholder')}
            maxLength={LIMITS.MAX_CONTACT_NAME_LENGTH}
            className="flex-1 min-w-0 bg-transparent py-2 text-base font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
          />
        </div>
      </div>

      {/* Address */}
      <div>
        <p className="text-caption font-medium text-foreground-muted mb-1">
          {t('contacts.address')}
        </p>
        <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
          <input
            type="text"
            aria-label={t('contacts.address')}
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setError('')
              setVerifyStatus('idle')
            }}
            placeholder={t('contacts.addressPlaceholder')}
            className="flex-1 min-w-0 bg-transparent py-2 text-base font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
          />
          <button
            onClick={() => {
              setShowScanner(true)
            }}
            aria-label={t('scanner.title')}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors shrink-0"
          >
            <CameraFilled className="text-foreground-muted" />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1.5 min-h-[20px]">
          {verifyStatus === 'verifying' && (
            <Loader2 className="w-3.5 h-3.5 text-foreground-muted animate-spin" />
          )}
          {verifyStatus === 'valid' && (
            <CheckCircle2 className="w-3.5 h-3.5 text-accent-primary" />
          )}
          {verifyStatus === 'invalid' && (
            <AlertCircle className="w-3.5 h-3.5 text-accent-danger" />
          )}
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-caption text-accent-danger">{error}</p>}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="secondary"
          size="lg"
          onClick={onClose}
          className="flex-1"
        >
          {t('common.cancel')}
        </Button>
        <Button
          variant="brand"
          size="lg"
          onClick={handleSave}
          loading={verifyStatus === 'verifying'}
          className="flex-1"
        >
          {isEdit ? t('common.save') : t('common.add')}
        </Button>
      </div>

      <QrScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleScan}
      />
    </div>
  )
}
