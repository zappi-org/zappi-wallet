import { useState, useCallback } from 'react'
import { Copy, Check, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'

interface LightningDetailPageProps {
  onBack: () => void
  onChangeUsername?: () => void
}

export function LightningDetailPage({ onBack, onChangeUsername }: LightningDetailPageProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  const address = settings.lightningAddress || ''

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

  return (
    <SettingsDetailPage title={t('settings.lightningAddress')} onBack={onBack}>
      <div className="flex flex-col items-center px-6 pt-8">
        {/* QR Code — tappable to copy */}
        <button
          onClick={handleCopy}
          className="bg-white p-4 rounded-2xl shadow-sm active:scale-[0.97] transition-transform"
        >
          <QRCodeDisplay value={address} size={200} className="rounded-xl" />
        </button>

        {/* Address text */}
        <p className="mt-6 text-body font-medium text-foreground text-center break-all leading-relaxed px-4">
          {address}
        </p>

        {/* Copy button */}
        <Button variant="brand" size="lg" onClick={handleCopy} className="w-full max-w-[320px] mt-6">
          {copied ? (
            <><Check className="w-4 h-4 mr-2" /> {t('common.copied')}</>
          ) : (
            <><Copy className="w-4 h-4 mr-2" /> {t('common.copy')}</>
          )}
        </Button>

        {/* Change username */}
        {onChangeUsername && (
          <Button variant="outline" size="lg" onClick={onChangeUsername} className="w-full max-w-[320px] mt-3">
            <Pencil className="w-4 h-4 mr-2" />
            {t('common.change')}
          </Button>
        )}
      </div>
    </SettingsDetailPage>
  )
}
