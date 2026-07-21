/**
 * ReceiveAddressStep — zero-tap landing: a payable static-address QR the
 * moment receive opens. Tab picks the identity being shared (lightning
 * address vs nostr npub); flow actions live on the bottom bar regardless.
 */
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Share2, Pencil } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { DirectionalTabPanel } from '@/ui/components/common/DirectionalTabPanel'
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'

export type ReceiveAddressTab = 'lightning' | 'nostr'

export interface ReceiveAddressStepProps {
  onBack: () => void
  addressTab: ReceiveAddressTab
  onTabChange: (tab: ReceiveAddressTab) => void
  lightningAddress: string | null
  npub: string | null
  mintUrl: string | null
  mintIconUrl?: string | null
  mintDisplayName: string
  onEditMint: () => void
  onDirectReceive: () => void
  onSpecifyAmount: () => void
  onCreateAddress?: () => void
}

export function ReceiveAddressStep({
  onBack, addressTab, onTabChange, lightningAddress, npub,
  mintUrl, mintIconUrl, mintDisplayName, onEditMint, onDirectReceive, onSpecifyAmount,
  onCreateAddress,
}: ReceiveAddressStepProps) {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  const value = addressTab === 'lightning' ? lightningAddress : npub

  const handleCopy = useCallback(async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      hapticTap()
      addToast({ type: 'success', message: t('common.copied'), duration: 2000 })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [value, addToast, t])

  const handleShare = useCallback(async () => {
    if (!value) return
    hapticTap()
    try {
      if (navigator.share) await navigator.share({ text: value })
      else await handleCopy()
    } catch { /* user cancelled */ }
  }, [value, handleCopy])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto flex flex-col items-center px-6 pt-4">
        <Tabs
          value={addressTab}
          onValueChange={(v) => { hapticTap(); onTabChange(v as ReceiveAddressTab) }}
          className="w-full max-w-[360px]"
        >
          <TabsList className="h-11 w-full rounded-2xl bg-foreground/[0.04] p-1">
            <TabsTrigger value="lightning" className="rounded-xl text-subtitle font-medium data-[state=active]:bg-background-card">
              {t('receive.landing.lightningTab')}
            </TabsTrigger>
            <TabsTrigger value="nostr" className="rounded-xl text-subtitle font-medium data-[state=active]:bg-background-card">
              {t('receive.landing.nostrTab')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <DirectionalTabPanel
          tabKey={addressTab}
          tabIndex={addressTab === 'lightning' ? 0 : 1}
          className="w-full flex flex-col items-center"
        >
          {value ? (
            <>
              <button
                type="button"
                aria-label={t('common.copy')}
                onClick={handleCopy}
                className="mt-6 cursor-pointer active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
              >
                <QRCodeDisplay value={value} size={200} className="rounded-2xl p-3 shadow-[0_2px_12px_rgba(0,0,0,0.08)]" />
              </button>
              <p className="mt-4 max-w-full break-all px-4 text-center text-body font-medium">{value}</p>
              <div className="flex gap-10 mt-4">
                <button onClick={handleShare} className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all">
                  <Share2 className="w-5 h-5" />
                  {t('receive.qr.share')}
                </button>
                <button onClick={handleCopy} className="flex items-center gap-1.5 text-subtitle font-medium text-foreground-muted active:text-foreground active:scale-95 motion-reduce:active:scale-100 transition-all">
                  {copied ? <Check className="w-5 h-5 text-brand" /> : <Copy className="w-5 h-5" />}
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
            </>
          ) : (
            // Lightning tab without a registered address (npub is always derivable)
            <div className="mt-10 flex flex-col items-center gap-4">
              <p className="text-body text-foreground-muted">{t('receive.landing.noAddress')}</p>
              {onCreateAddress && (
                <Button variant="secondary" size="md" onClick={() => { hapticTap(); onCreateAddress() }}>
                  {t('receive.landing.createAddress')}
                </Button>
              )}
            </div>
          )}
        </DirectionalTabPanel>

        {addressTab === 'lightning' && mintUrl && (
          <button
            type="button"
            onClick={() => { hapticTap(); onEditMint() }}
            className="mt-6 w-full max-w-[360px] flex items-center gap-3 rounded-2xl bg-foreground/[0.04] px-4 py-3 active:bg-foreground/[0.07] transition-colors"
          >
            <MintIcon iconUrl={mintIconUrl ?? undefined} imgSize="w-6 h-6" className="w-8 h-8" circle />
            <span className="flex-1 text-left">
              <span className="block text-caption text-foreground-muted">{t('receive.landing.receiveAccount')}</span>
              <span className="block text-body font-medium">{mintDisplayName}</span>
            </span>
            <Pencil className="w-4 h-4 text-foreground-muted" />
          </button>
        )}
      </div>

      <div className="flex gap-3 px-6 pb-app shrink-0">
        <Button variant="secondary" size="xl" onClick={() => { hapticTap(); onDirectReceive() }} className="flex-none px-5">
          {t('receive.landing.directReceive')}
        </Button>
        <Button variant="brand" size="xl" onClick={() => { hapticTap(); onSpecifyAmount() }} className="flex-1">
          {t('receive.landing.specifyAmount')}
        </Button>
      </div>
    </div>
  )
}
