import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { useAppStore } from '@/store'
import { useCrypto } from '@/ui/hooks/use-crypto'
import { hapticTap } from '@/utils/haptic'

interface NpubDetailPageProps {
  onBack: () => void
}

export function NpubDetailPage({ onBack }: NpubDetailPageProps) {
  const { t } = useTranslation()
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const addToast = useAppStore((s) => s.addToast)
  const crypto = useCrypto()
  const [copied, setCopied] = useState(false)

  const npub = nostrPubkey ? crypto.encodeNpub(nostrPubkey) : ''

  const handleCopy = useCallback(async () => {
    hapticTap()
    try {
      await navigator.clipboard.writeText(npub)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = npub
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    addToast({ type: 'success', message: t('toast.copied'), duration: 1500 })
    setTimeout(() => setCopied(false), 2000)
  }, [npub, addToast, t])

  return (
    <SettingsDetailPage title="Nostr" onBack={onBack}>
      <div className="flex flex-col items-center px-6 pt-8">
        {/* QR Code — tappable to copy */}
        <button
          onClick={handleCopy}
          className="bg-white p-4 rounded-2xl shadow-sm active:scale-[0.97] transition-transform"
        >
          <QRCodeDisplay value={npub} size={200} className="rounded-xl" />
        </button>

        {/* Address text */}
        <p className="mt-6 text-body font-medium text-foreground text-center break-all leading-relaxed px-4">
          {npub}
        </p>

        {/* Copy button */}
        <Button variant="brand" size="lg" onClick={handleCopy} className="w-full max-w-[320px] mt-6">
          {copied ? (
            <><Check className="w-4 h-4 mr-2" /> {t('common.copied')}</>
          ) : (
            <><Copy className="w-4 h-4 mr-2" /> {t('common.copy')}</>
          )}
        </Button>
      </div>
    </SettingsDetailPage>
  )
}
