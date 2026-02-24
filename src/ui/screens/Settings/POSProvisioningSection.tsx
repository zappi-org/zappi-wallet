import { useState, useCallback, useMemo } from 'react'
import { Monitor, Plus, Trash2, ChevronRight, Copy, Check, Zap, Pencil } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, PinInput } from '../../components/common'
import { cn } from '@/components/ui/utils'
import { derivePOSSubKey, getP2PKPubkey } from '@/services/crypto'
import type { POSDevice, POSProvisioningPayload, WalletSettings } from '@/core/types'

export interface POSProvisioningSectionProps {
  settings: WalletSettings
  nostrPubkey: string | null
  nostrPrivkey: string | null
  lightningAddress: string | undefined
  isRegistering: boolean
  onRegisterLightningAddress: () => void
  onOpenUsernameChange?: () => void
  onBackupMnemonic: (password: string) => Promise<string | null>
  onSaveSettings: (updates: Record<string, unknown>) => Promise<void>
}

export function POSProvisioningSection({
  settings,
  nostrPubkey,
  nostrPrivkey,
  lightningAddress,
  isRegistering,
  onRegisterLightningAddress,
  onOpenUsernameChange,
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

  // Parse zappiLink info from Lightning Address + stored API URL
  const parseLightningAddress = useCallback(() => {
    const la = settings.lightningAddress
    if (!la || !la.includes('@')) return null
    const [user] = la.split('@')
    if (!user) return null
    // Use stored API URL from LNURL callback, fallback to domain
    const zappiLinkUrl = settings.zappiLinkApiUrl || `https://${la.split('@')[1]}`
    return { zappiLinkUrl, zappiLinkUser: user }
  }, [settings.lightningAddress, settings.zappiLinkApiUrl])

  const handleAddDevice = useCallback(async () => {
    if (pin.length !== 6) return
    setIsLoading(true)
    setPinError('')

    try {
      // Decrypt mnemonic with PIN
      const mnemonic = await onBackupMnemonic(pin)
      if (!mnemonic) {
        setPinError(t('settings.wrongPin'))
        setPin('')
        setIsLoading(false)
        return
      }

      // Compute next POS index
      const nextIndex = posDevices.length > 0
        ? Math.max(...posDevices.map(d => d.index)) + 1
        : 0

      // Derive sub-keypair
      const subKey = derivePOSSubKey(mnemonic, nextIndex)

      // Get wallet's P2PK pubkey (re-lock target)
      const walletP2pkPubkey = nostrPrivkey
        ? getP2PKPubkey(nostrPrivkey)
        : null

      if (!walletP2pkPubkey || !nostrPubkey) {
        setPinError('Wallet keys not available')
        setIsLoading(false)
        return
      }

      // Build provisioning payload
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

      // Encode as zpos1 + base64url
      const jsonStr = JSON.stringify(payload)
      const base64 = btoa(jsonStr)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      const encoded = `zpos1${base64}`

      // Save device record
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

      // Show QR
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
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.posManagement')}</h3>
        <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50 divide-y divide-primary/5">
          {/* Lightning Address */}
          <div className="p-3">
            <label className="text-[10px] font-bold text-foreground-muted ml-1 block mb-1.5">{t('settings.lightningAddress')}</label>
            {lightningAddress ? (
              <div className="flex items-center gap-2 bg-accent-primary/5 p-2.5 rounded-xl">
                <Zap className="w-4 h-4 text-accent-primary shrink-0" />
                <span className="text-xs font-bold text-foreground truncate">{lightningAddress}</span>
                <button
                  onClick={onOpenUsernameChange}
                  className="p-1 text-foreground-muted hover:text-accent-primary transition-colors shrink-0 ml-auto"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <p className="text-[10px] text-foreground-muted mb-2 ml-1">
                  {t('settings.lightningAddressRequired')}
                </p>
                <button
                  onClick={onRegisterLightningAddress}
                  disabled={isRegistering}
                  className={cn(
                    'w-full p-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all',
                    isRegistering
                      ? 'bg-primary/10 text-foreground-muted cursor-wait'
                      : 'bg-primary text-white hover:bg-primary-hover shadow-lg shadow-primary/20 active:scale-[0.98]'
                  )}
                >
                  {isRegistering ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      {t('settings.registeringLightningAddress')}
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5" />
                      {t('settings.registerLightningAddress')}
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Device list */}
          {posDevices.map((device) => (
            <div
              key={device.index}
              className="p-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                  <Monitor className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-xs">{device.label}</span>
                  <span className="text-[10px] text-foreground-muted">
                    #{device.index} &middot; {new Date(device.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowRemoveModal(device)}
                className="p-2 text-foreground-muted hover:text-accent-danger transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {posDevices.length === 0 && (
            <div className="p-3 text-center text-[10px] text-foreground-muted">
              {t('settings.noPosDevices')}
            </div>
          )}

          {/* Add device button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <div className="p-2 bg-accent-primary/10 rounded-xl text-accent-primary">
                <Plus className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs">{t('settings.addPosDevice')}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-foreground-muted" />
          </button>
        </div>
      </section>

      {/* Add Device Modal */}
      <Modal isOpen={showAddModal} onClose={resetAddModal} title={t('settings.posProvisioningTitle')}>
        <div className="py-3 space-y-4">
          {!settings.lightningAddress && (
            <div className="bg-accent-warning/10 border border-accent-warning/20 p-3 rounded-xl">
              <p className="text-[10px] text-accent-warning font-bold">
                {t('settings.posNoLightningAddress')}
              </p>
            </div>
          )}

          {/* Device label input */}
          <div>
            <label className="text-xs font-bold text-foreground-muted mb-1 block">
              {t('settings.posDeviceLabel')}
            </label>
            <input
              type="text"
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              placeholder={t('settings.posDeviceLabelPlaceholder')}
              className="w-full p-2.5 rounded-xl border border-primary/10 bg-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* PIN input */}
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
          <p className="text-xs text-foreground-muted text-center">
            {t('settings.posProvisioningDescription')}
          </p>

          <div className="flex justify-center p-4 bg-white rounded-2xl">
            <QRCodeSVG value={qrPayload} size={220} level="L" />
          </div>

          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-primary/10 bg-white/60 text-xs font-bold transition-colors hover:bg-white/80"
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
          <p className="text-xs text-foreground-muted">
            {t('settings.posDeviceRemoveWarning')}
          </p>
          {showRemoveModal && (
            <div className="flex items-center gap-2 bg-white/60 p-3 rounded-xl border border-white/50">
              <Monitor className="w-4 h-4 text-foreground-muted" />
              <span className="font-bold text-sm">{showRemoveModal.label}</span>
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
              className="flex-1 p-2 rounded-xl font-bold bg-accent-danger text-white hover:bg-accent-danger-hover shadow-lg shadow-accent-danger/30 transition-colors"
            >
              {t('settings.posDeviceRemove')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
