import { useState, useCallback, useMemo } from 'react'
import { Trash2, ChevronRight, Copy, Check, Store } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, PinInput } from '../../components/common'
import { derivePOSSubKey, getP2PKPubkey } from '@/services/crypto'
import type { POSDevice, POSProvisioningPayload, WalletSettings } from '@/core/types'

export interface POSProvisioningSectionProps {
  settings: WalletSettings
  nostrPubkey: string | null
  nostrPrivkey: string | null
  onBackupMnemonic: (password: string) => Promise<string | null>
  onSaveSettings: (updates: Record<string, unknown>) => Promise<void>
}

export function POSProvisioningSection({
  settings,
  nostrPubkey,
  nostrPrivkey,
  onBackupMnemonic,
  onSaveSettings,
}: POSProvisioningSectionProps) {
  const { t } = useTranslation()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [showRemoveModal, setShowRemoveModal] = useState<POSDevice | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [qrPayload, setQrPayload] = useState('')
  const [copied, setCopied] = useState(false)

  const posDevices = useMemo(() => settings.posDevices ?? [], [settings.posDevices])

  const parseLightningAddress = useCallback(() => {
    const la = settings.lightningAddress
    if (!la || !la.includes('@')) return null
    const [user] = la.split('@')
    if (!user) return null
    const zappiLinkUrl = settings.zappiLinkApiUrl || `https://${la.split('@')[1]}`
    return { zappiLinkUrl, zappiLinkUser: user }
  }, [settings.lightningAddress, settings.zappiLinkApiUrl])

  const handleAddDevice = useCallback(async () => {
    if (pin.length !== 6) return
    setIsLoading(true)
    setPinError('')

    try {
      const mnemonic = await onBackupMnemonic(pin)
      if (!mnemonic) {
        setPinError(t('settings.wrongPin'))
        setPin('')
        setIsLoading(false)
        return
      }

      const nextIndex = posDevices.length > 0
        ? Math.max(...posDevices.map(d => d.index)) + 1
        : 0

      const subKey = derivePOSSubKey(mnemonic, nextIndex)

      const walletP2pkPubkey = nostrPrivkey
        ? getP2PKPubkey(nostrPrivkey)
        : null

      if (!walletP2pkPubkey || !nostrPubkey) {
        setPinError('Wallet keys not available')
        setIsLoading(false)
        return
      }

      const lightningInfo = parseLightningAddress()
      const payload: POSProvisioningPayload = {
        version: 1,
        walletPubkey: walletP2pkPubkey,
        walletNostrPubkey: nostrPubkey,
        subKeypair: {
          index: subKey.index,
          p2pkPublicKey: subKey.p2pkPublicKey,
          p2pkPrivateKey: subKey.p2pkPrivateKey,
          nostrPublicKey: subKey.nostrPublicKey,
          nostrPrivateKey: subKey.nostrPrivateKey,
        },
        zappiLinkUrl: lightningInfo?.zappiLinkUrl,
        zappiLinkUser: lightningInfo?.zappiLinkUser,
        mints: settings.mints,
        relays: settings.relays,
      }

      const jsonStr = JSON.stringify(payload)
      const base64 = btoa(jsonStr)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const encoded = `zpos1${base64}`

      const label = deviceLabel.trim() || `POS ${nextIndex + 1}`
      const newDevice: POSDevice = {
        index: nextIndex,
        label,
        p2pkPublicKey: subKey.p2pkPublicKey,
        nostrPublicKey: subKey.nostrPublicKey,
        createdAt: Date.now(),
      }
      const updatedDevices = [...posDevices, newDevice]
      await onSaveSettings({ posDevices: updatedDevices })

      setQrPayload(encoded)
      setShowAddModal(false)
      setShowQrModal(true)
      setPin('')
      setDeviceLabel('')
    } catch {
      setPinError(t('lock.errorOccurred'))
    } finally {
      setIsLoading(false)
    }
  }, [pin, posDevices, nostrPrivkey, nostrPubkey, deviceLabel, settings.mints, settings.relays, parseLightningAddress, onBackupMnemonic, onSaveSettings, t])

  const handleRemoveDevice = useCallback(async () => {
    if (!showRemoveModal) return
    const updatedDevices = posDevices.filter(d => d.index !== showRemoveModal.index)
    await onSaveSettings({ posDevices: updatedDevices })
    setShowRemoveModal(null)
  }, [showRemoveModal, posDevices, onSaveSettings])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(qrPayload)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [qrPayload])

  const resetAddModal = useCallback(() => {
    setShowAddModal(false)
    setPin('')
    setPinError('')
    setDeviceLabel('')
  }, [])

  return (
    <>
      <section>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2 flex items-center gap-1.5">
          <Store className="w-3.5 h-3.5" />
          {t('settings.posManagement')}
        </p>
        <div className="bg-background-card">
          {/* Device list */}
          {posDevices.map((device) => (
            <div
              key={device.index}
              className="px-4 py-3.5 flex items-center justify-between"
            >
              <div>
                <span className="text-[14px] font-medium block">{device.label}</span>
                <span className="text-[12px] text-foreground-muted">
                  #{device.index} &middot; {new Date(device.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => setShowRemoveModal(device)}
                className="p-2 text-foreground-muted active:text-accent-danger"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {posDevices.length === 0 && (
            <div className="px-4 py-3.5 text-center text-[12px] text-foreground-muted">
              {t('settings.noPosDevices')}
            </div>
          )}

          {/* Add device button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
          >
            <span className="text-[14px] font-medium text-accent-primary">{t('settings.addPosDevice')}</span>
            <ChevronRight className="w-4 h-4 text-foreground-subtle" />
          </button>
        </div>
      </section>

      {/* Add Device Modal */}
      <Modal isOpen={showAddModal} onClose={resetAddModal} title={t('settings.posProvisioningTitle')}>
        <div className="py-3 space-y-4">
          {!settings.lightningAddress && (
            <div className="border-l-2 border-accent-warning bg-accent-warning/[0.06] p-3">
              <p className="text-[11px] text-accent-warning font-semibold">
                {t('settings.posNoLightningAddress')}
              </p>
            </div>
          )}

          <div>
            <label className="text-[12px] font-semibold text-foreground-muted mb-1 block">
              {t('settings.posDeviceLabel')}
            </label>
            <input
              type="text"
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              placeholder={t('settings.posDeviceLabelPlaceholder')}
              className="w-full p-2.5 rounded-sm border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <PinInput
            value={pin}
            onChange={(v) => { setPin(v); setPinError('') }}
            label={t('settings.enterPinLabel')}
            error={pinError}
          />

          <Button
            variant="primary"
            size="lg"
            onClick={handleAddDevice}
            loading={isLoading}
            disabled={pin.length !== 6}
            className="w-full"
          >
            {t('settings.addPosDevice')}
          </Button>
        </div>
      </Modal>

      {/* QR Display Modal */}
      <Modal
        isOpen={showQrModal}
        onClose={() => { setShowQrModal(false); setQrPayload('') }}
        title={t('settings.posProvisioningTitle')}
      >
        <div className="py-3 space-y-4">
          <p className="text-[12px] text-foreground-muted text-center">
            {t('settings.posProvisioningDescription')}
          </p>

          <div className="flex justify-center p-4 bg-white">
            <QRCodeSVG value={qrPayload} size={220} level="L" />
          </div>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm border border-border text-[13px] font-semibold active:bg-background-hover"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-accent-success" />
                <span className="text-accent-success">{t('common.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t('common.copy')}</span>
              </>
            )}
          </button>

          <Button
            variant="primary"
            size="lg"
            onClick={() => { setShowQrModal(false); setQrPayload(''); setCopied(false) }}
            className="w-full"
          >
            {t('settings.posProvisioningDone')}
          </Button>
        </div>
      </Modal>

      {/* Remove Device Confirmation */}
      <Modal
        isOpen={!!showRemoveModal}
        onClose={() => setShowRemoveModal(null)}
        title={t('settings.posDeviceRemove')}
      >
        <div className="py-3 space-y-3">
          <p className="text-[12px] text-foreground-muted">
            {t('settings.posDeviceRemoveWarning')}
          </p>
          {showRemoveModal && (
            <div className="bg-background p-3 border border-border rounded-sm">
              <span className="font-semibold text-[13px]">{showRemoveModal.label}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setShowRemoveModal(null)}
              className="flex-1"
            >
              {t('common.cancel')}
            </Button>
            <button
              onClick={handleRemoveDevice}
              className="flex-1 py-2 rounded-sm font-semibold text-[13px] bg-accent-danger text-white active:opacity-80"
            >
              {t('settings.posDeviceRemove')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
