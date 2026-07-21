import { useState, useCallback, useEffect } from 'react'
import { Copy, Check, Pencil, ChevronDown, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { Switch } from '@/ui/components/common/Switch'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { hapticTap } from '@/ui/utils/haptic'
import { formatMintHost } from '@/utils/url'
import type { ClaimStorageMode } from '@/core/ports/driven/payment-alias-provider.port'
import ChangeUsernameSheet from '../ChangeUsernameSheet'

interface LightningDetailPageProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function LightningDetailPage({ onBack, onSaveSettings }: LightningDetailPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const addToast = useAppStore((s) => s.addToast)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [copied, setCopied] = useState(false)
  const [preferredMint, setPreferredMint] = useState<string | null>(null)
  const [showMintPicker, setShowMintPicker] = useState(false)
  const [showChangeSheet, setShowChangeSheet] = useState(false)
  const [changeSheetKey, setChangeSheetKey] = useState(0)
  const registry = useServiceRegistry()

  const [claimStorageMode, setClaimStorageMode] = useState<ClaimStorageMode>('off')
  const [claimStorageBalance, setClaimStorageBalance] = useState(0)
  const [claiming, setClaiming] = useState(false)

  const address = settings.lightningAddress || ''

  useEffect(() => {
    if (!nostrPrivkey) return
    registry.paymentAlias.getAlias(nostrPrivkey).then((r) => {
      if (r.ok) {
        setPreferredMint(r.value.mintUrl)
        setClaimStorageMode(r.value.claimStorageMode ?? 'off')
        setClaimStorageBalance(r.value.claimBalance ?? 0)
      }
    })
  }, [nostrPrivkey, registry])

  const handleCopy = useCallback(async () => {
    hapticTap()
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = address
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    addToast({ type: 'success', message: t('toast.copied'), duration: 1500 })
    setTimeout(() => setCopied(false), 2000)
  }, [address, addToast, t])

  const handleSetMint = useCallback(async (mintUrl: string) => {
    if (!nostrPrivkey) return
    const result = await registry.paymentAlias.setMint(nostrPrivkey, mintUrl)
    if (result.ok) {
      setPreferredMint(mintUrl)
      setShowMintPicker(false)
      updateSettings({ npubcashUrl: mintUrl })
      addToast({ type: 'success', message: t('settings.mintChanged') })
    } else {
      addToast({ type: 'error', message: (result.error as { message?: string }).message ?? t('settings.mintChangeFailed') })
    }
  }, [nostrPrivkey, registry, addToast, updateSettings, t])

  const handleClaimStorageToggle = useCallback(async (enabled: boolean) => {
    if (!nostrPrivkey) return
    const nextMode: ClaimStorageMode = enabled ? 'on_expire' : 'off'
    const result = await registry.claimStorage.setClaimStorageMode(nostrPrivkey, nextMode)
    if (result.ok) {
      setClaimStorageMode(result.value)
      addToast({ type: 'success', message: enabled ? t('settings.claimStorageEnabled') : t('settings.claimStorageDisabled') })
    } else {
      addToast({ type: 'error', message: (result.error as { message?: string }).message ?? t('common.error') })
    }
  }, [nostrPrivkey, registry, addToast, t])

  const handleClaim = useCallback(async () => {
    if (!nostrPrivkey || claiming) return
    setClaiming(true)
    try {
      const result = await registry.claimStorage.getClaim(nostrPrivkey)
      if (result.ok) {
        for (const { token } of result.value.tokens) {
          try {
            await registry.payment.redeem({ input: token })
          } catch {
            // skip individual token redeem failures
          }
        }
        addToast({ type: 'success', message: t('settings.claimSuccess', { count: result.value.totalCount }) })
        const bal = await registry.claimStorage.getBalance(nostrPrivkey)
        if (bal.ok) setClaimStorageBalance(bal.value)
      } else {
        addToast({ type: 'error', message: (result.error as { message?: string }).message ?? t('settings.claimFailed') })
      }
    } finally {
      setClaiming(false)
    }
  }, [nostrPrivkey, claiming, registry, addToast, t])

  return (
    <>
    <SettingsDetailPage title={t('settings.lightningAddress')} onBack={onBack}>
      <div className="flex flex-col items-center px-6 pt-8">
        <button
          onClick={handleCopy}
          className="bg-white p-4 rounded-2xl shadow-sm active:scale-[0.97] transition-transform"
        >
          <QRCodeDisplay value={address} size={200} className="rounded-xl" />
        </button>

        <p className="mt-6 text-body font-medium text-foreground text-center break-all leading-relaxed px-4">
          {address}
        </p>

        <Button variant="brand" size="lg" onClick={handleCopy} className="w-full max-w-[320px] mt-6">
          {copied ? (
            <><Check className="w-4 h-4 mr-2" /> {t('common.copied')}</>
          ) : (
            <><Copy className="w-4 h-4 mr-2" /> {t('common.copy')}</>
          )}
        </Button>

        <Button variant="outline" size="lg" onClick={() => { setShowChangeSheet(true); setChangeSheetKey(k => k + 1) }} className="w-full max-w-[320px] mt-3">
          <Pencil className="w-4 h-4 mr-2" />
          {t('common.change')}
        </Button>

        <div className="w-full max-w-[320px] mt-6">
          <p className="text-body font-medium text-foreground-muted mb-2">{t('settings.receiveMint')}</p>
          <button
            onClick={() => setShowMintPicker(!showMintPicker)}
            className="w-full flex items-center justify-between bg-foreground/[0.04] rounded-xl px-4 py-3 hover:bg-foreground/[0.06] transition-colors"
          >
            <span className="text-body text-foreground truncate">
              {preferredMint ? formatMintHost(preferredMint) : t('settings.noMint')}
            </span>
            <ChevronDown className={`w-4 h-4 text-foreground-muted transition-transform ${showMintPicker ? 'rotate-180' : ''}`} />
          </button>

          {showMintPicker && (
            <div className="mt-2 bg-foreground/[0.04] rounded-xl overflow-hidden">
              {settings.mints.map((mintUrl) => (
                <button
                  key={mintUrl}
                  onClick={() => handleSetMint(mintUrl)}
                  className={`w-full text-left px-4 py-3 text-body hover:bg-foreground/[0.06] transition-colors ${mintUrl === preferredMint ? 'text-brand font-medium' : 'text-foreground'}`}
                >
                  {formatMintHost(mintUrl)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-full max-w-[320px] mt-6 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-body font-medium text-foreground">{t('settings.claimStorageTitle')}</p>
              <p className="text-caption text-foreground-muted mt-0.5">{t('settings.claimStorageDesc')}</p>
            </div>
            <Switch
              checked={claimStorageMode === 'on_expire'}
              onChange={handleClaimStorageToggle}
            />
          </div>

          {claimStorageBalance > 0 && (
            <div className="flex items-center justify-between mt-4 bg-foreground/[0.04] rounded-xl px-4 py-3">
              <span className="text-body text-foreground">
                {t('settings.claimStorageStoredBalance')}: {claimStorageBalance.toLocaleString()} sats
              </span>
              <Button
                variant="brand"
                size="sm"
                onClick={handleClaim}
                disabled={claiming}
              >
                <Download className="w-4 h-4 mr-1.5" />
                {claiming ? t('common.processing') : t('settings.claimNow')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </SettingsDetailPage>
    <ChangeUsernameSheet
      key={changeSheetKey}
      isOpen={showChangeSheet}
      onClose={() => setShowChangeSheet(false)}
      onSaveSettings={onSaveSettings}
    />
    </>
  )
}
