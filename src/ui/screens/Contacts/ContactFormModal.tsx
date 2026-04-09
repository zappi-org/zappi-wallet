import { useState, useCallback } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/ui/components/common'
import { Button } from '@/ui/components/common/Button'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import type { Contact } from '@/core/types'
import type { ContactAddressType } from '@/core/types/contact'

function detectAddressType(address: string): ContactAddressType {
  const trimmed = address.trim()
  if (trimmed.includes('@')) return 'lightning'
  if (trimmed.startsWith('npub1')) return 'npub'
  return 'custom'
}
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useCrypto } from '@/ui/hooks/use-crypto'

interface ContactFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: { name: string; address: string }) => void
  contact?: Contact | null
}

type VerifyStatus = 'idle' | 'verifying' | 'valid' | 'invalid'

type VerifyErrorCode = 'invalidFormat' | 'notReachable' | 'invalidNpub' | 'noNutzapInfo' | 'noMints' | 'decodeFailed'

type AddressVerifier = { resolve(address: string): Promise<{ capabilities: { directToken?: { mints: string[] } } }> }
type NpubDecoder = { decodeNpub(npub: string): { type: string; data: string } }

async function verifyAddress(
  address: string,
  type: ContactAddressType,
  addressResolver: AddressVerifier,
  crypto: NpubDecoder,
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
      const decoded = crypto.decodeNpub(address)
      if (decoded.type !== 'npub') return { valid: false, errorCode: 'invalidNpub' }

      try {
        const result = await addressResolver.resolve(address)
        const mints = result.capabilities.directToken?.mints
        if (!mints || mints.length === 0) {
          return { valid: false, errorCode: 'noMints' }
        }
        return { valid: true }
      } catch {
        return { valid: false, errorCode: 'noNutzapInfo' }
      }
    } catch {
      return { valid: false, errorCode: 'decodeFailed' }
    }
  }

  // custom type — no verification
  return { valid: true }
}

export function ContactFormModal({ isOpen, onClose, onSave, contact }: ContactFormModalProps) {
  const { t } = useTranslation()
  const resetKey = `${isOpen}-${contact?.id ?? 'new'}`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={contact ? t('contacts.editContact') : t('contacts.addContact')}
    >
      <ContactFormInner key={resetKey} contact={contact} onSave={onSave} onClose={onClose} />
    </Modal>
  )
}

function ContactFormInner({ contact, onSave, onClose }: { contact?: Contact | null; onSave: ContactFormModalProps['onSave']; onClose: () => void }) {
  const { t } = useTranslation()
  const { addressResolver } = useServiceRegistry()
  const crypto = useCrypto()
  const [name, setName] = useState(contact?.name || '')
  const [address, setAddress] = useState(contact?.address || '')
  const [error, setError] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
  const [showScanner, setShowScanner] = useState(false)

  const isEdit = !!contact

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim()
    const trimmedAddress = address.trim()

    if (!trimmedName) {
      setError(t('contacts.nameRequired'))
      return
    }
    if (!trimmedAddress) {
      setError(t('contacts.addressRequired'))
      return
    }

    const addrType = detectAddressType(trimmedAddress)

    if (addrType !== 'lightning' && addrType !== 'npub') {
      setError(t('contacts.onlyLightningOrNpub'))
      return
    }

    setVerifyStatus('verifying')
    setError('')
    const result = await verifyAddress(trimmedAddress, addrType, addressResolver, crypto)
    if (!result.valid) {
      setVerifyStatus('invalid')
      const errorKey = result.errorCode ? `contacts.verify.${result.errorCode}` : 'contacts.verificationFailed'
      setError(t(errorKey))
      return
    }
    setVerifyStatus('valid')

    onSave({ name: trimmedName, address: trimmedAddress })
    onClose()
  }, [name, address, onSave, onClose, t, addressResolver, crypto])

  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    const trimmed = result.trim()
    if (trimmed) {
      setAddress(trimmed)
      setError('')
      setVerifyStatus('idle')
    }
  }, [])

  return (
      <div className="space-y-5 py-2">
        {/* Name */}
        <div>
          <p className="text-caption font-medium text-foreground-muted mb-1">
            {t('contacts.name')} <span className="text-overline text-foreground-muted/50 ml-1">{name.length}/10</span>
          </p>
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value.slice(0, 10)); setError('') }}
              placeholder={t('contacts.namePlaceholder')}
              maxLength={10}
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
          </div>
        </div>

        {/* Address */}
        <div>
          <p className="text-caption font-medium text-foreground-muted mb-1">{t('contacts.address')}</p>
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setError(''); setVerifyStatus('idle') }}
              placeholder={t('contacts.addressPlaceholder')}
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
            <button
              onClick={() => setShowScanner(true)}
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
        {error && (
          <p className="text-caption text-accent-danger">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="lg" onClick={onClose} className="flex-1">
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

        <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
      </div>
  )
}
