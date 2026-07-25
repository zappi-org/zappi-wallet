import { useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SettingsDetailPage } from '../components/SettingsDetailPage'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { useCopyFeedback } from '@/ui/hooks/use-copy-feedback'
import { useAppStore } from '@/store'
import { useCrypto } from '@/ui/hooks/use-crypto'

interface NpubDetailPageProps {
  onBack: () => void
}

export function NpubDetailPage({ onBack }: NpubDetailPageProps) {
  const { t } = useTranslation()
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const crypto = useCrypto()
  const { isCopied, copy } = useCopyFeedback()

  const npub = nostrPubkey ? crypto.encodeNpub(nostrPubkey) : ''

  const handleCopy = useCallback(() => copy(npub), [npub, copy])

  return (
    <SettingsDetailPage title="Nostr" onBack={onBack}>
      <div className="flex flex-col items-center px-6 pt-8">
        {/* QR Code — tappable to copy. Framing (bg/padding/shadow) lives on
            QRCodeDisplay itself; a second frame here would double it up. */}
        <button
          onClick={handleCopy}
          className="w-full max-w-[360px] active:scale-[0.97] transition-transform"
        >
          <QRCodeDisplay value={npub} className="rounded-xl" />
        </button>

        {/* Address text */}
        <p className="mt-6 text-body font-medium text-foreground text-center break-all leading-relaxed px-4">
          {npub}
        </p>

        {/* Copy button */}
        <Button variant="brand" size="lg" onClick={handleCopy} className="w-full max-w-[320px] mt-6">
          {isCopied() ? (
            <><Check className="w-4 h-4 mr-2" /> {t('common.copied')}</>
          ) : (
            <><Copy className="w-4 h-4 mr-2" /> {t('common.copy')}</>
          )}
        </Button>
      </div>
    </SettingsDetailPage>
  )
}
