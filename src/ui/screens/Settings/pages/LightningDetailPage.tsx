import { useState, useCallback, useEffect } from 'react'
import { Copy, Check, Pencil, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { hapticTap } from '@/ui/utils/haptic'
import { formatMintHost } from '@/utils/url'

interface LightningDetailPageProps {
  onBack: () => void
  onChangeUsername?: () => void
  onChangeMint?: () => void
}

export function LightningDetailPage({ onBack, onChangeUsername, onChangeMint }: LightningDetailPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const addToast = useAppStore((s) => s.addToast)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [copied, setCopied] = useState(false)
  const [preferredMint, setPreferredMint] = useState<string | null>(null)
  const [showMintPicker, setShowMintPicker] = useState(false)
  const registry = useServiceRegistry()

  const address = settings.lightningAddress || ''

  useEffect(() => {
    if (!nostrPrivkey) return
    registry.paymentAlias.getAlias(nostrPrivkey).then((r) => {
      if (r.isOk()) setPreferredMint(r.value.mintUrl)
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
    if (result.isOk()) {
      setPreferredMint(mintUrl)
      setShowMintPicker(false)
      updateSettings({ npubcashMintUrl: mintUrl })
      addToast({ type: 'success', message: t('settings.mintChanged') })
    } else {
      addToast({ type: 'error', message: (result.error as { message?: string }).message ?? t('settings.mintChangeFailed') })
    }
  }, [nostrPrivkey, registry, addToast, updateSettings, t])

  return (
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

        {onChangeUsername && (
          <Button variant="outline" size="lg" onClick={onChangeUsername} className="w-full max-w-[320px] mt-3">
            <Pencil className="w-4 h-4 mr-2" />
            {t('common.change')}
          </Button>
        )}

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
      </div>
    </SettingsDetailPage>
  )
}
