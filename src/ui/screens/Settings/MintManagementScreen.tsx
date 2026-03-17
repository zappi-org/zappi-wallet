import { useState, useCallback, useEffect } from 'react'
import { ArrowLeft, Plus, ChevronDown, Trash2, Copy, Check, QrCode, ExternalLink } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useMintHealth } from '@/hooks/use-mint-health'
import { LIMITS } from '@/core/constants'
import { clearMintData } from '@/data/database/schema'
import { cn } from '@/components/ui/utils'
import { Modal } from '@/ui/components/common'
import { MintIcon } from './SettingsHelpers'
import { MintUrlQrModal } from '@/ui/screens/MintDetail/MintUrlQrModal'

// NUT names mapping
const NUT_NAMES: Record<string, string> = {
  '0': 'Cryptography', '1': 'Mint Keys', '2': 'Keysets', '3': 'Swap',
  '4': 'Mint (Lightning)', '5': 'Melt (Lightning)', '6': 'Mint Info',
  '7': 'State Check', '8': 'Fee Return', '9': 'Restore',
  '10': 'Spending Conditions', '11': 'P2PK', '12': 'DLEQ Proofs',
  '13': 'Deterministic Secrets', '14': 'HTLC', '15': 'MPP',
  '17': 'WebSocket', '18': 'Payment Request', '19': 'Cached Responses',
  '20': 'Signature on Quote',
}
const getNutName = (nut: string) => NUT_NAMES[nut] || `NUT-${nut.padStart(2, '0')}`

interface MintInfoData {
  name?: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: Array<{ method: string; info: string }>
  nuts?: Record<string, unknown>
  motd?: string
}

export interface MintManagementScreenProps {
  onBack: () => void
  onAddMint: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function MintManagementScreen({
  onBack,
  onAddMint,
  onSaveSettings,
}: MintManagementScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const balanceByMint = useAppStore((s) => s.balance.byMint)
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus, checkAllMints } = useMintHealth()

  const [expandedMint, setExpandedMint] = useState<string | null>(null)
  const [mintToDelete, setMintToDelete] = useState<string | null>(null)

  // Per-mint info cache: undefined = not fetched, 'loading' = in progress, object = data, null = error
  const [mintInfoCache, setMintInfoCache] = useState<Record<string, MintInfoData | null | 'loading'>>({})

  // QR modal
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // Copy states
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => { checkAllMints() }, [checkAllMints])

  const fetchMintInfo = useCallback((url: string) => {
    if (mintInfoCache[url] !== undefined) return
    setMintInfoCache((p) => ({ ...p, [url]: 'loading' }))
    fetch(`${url.replace(/\/$/, '')}/v1/info`)
      .then((res) => res.json())
      .then((data) => setMintInfoCache((p) => ({ ...p, [url]: data })))
      .catch(() => setMintInfoCache((p) => ({ ...p, [url]: null })))
  }, [mintInfoCache])

  const handleToggle = useCallback((url: string) => {
    setExpandedMint((prev) => {
      const next = prev === url ? null : url
      if (next) fetchMintInfo(next)
      return next
    })
  }, [fetchMintInfo])

  const handleCopy = useCallback(async (text: string, field: string) => {
    try { await navigator.clipboard.writeText(text) } catch { /* fallback */ }
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  const handleRemoveMint = useCallback((url: string) => {
    setMintToDelete(url)
  }, [])

  const confirmRemoveMint = useCallback(async () => {
    if (!mintToDelete) return
    const urlToDelete = mintToDelete
    setMintToDelete(null)
    if (expandedMint === urlToDelete) setExpandedMint(null)
    const newMints = settings.mints.filter((m) => m !== urlToDelete)
    await onSaveSettings({ mints: newMints })
    clearMintData(urlToDelete)
  }, [mintToDelete, settings.mints, onSaveSettings, expandedMint])

  const getMintBalance = (url: string) => {
    const normalized = url.endsWith('/') ? url.slice(0, -1) : url
    return balanceByMint[normalized] || balanceByMint[url] || 0
  }

  const formatMintUrl = (url: string) => {
    try { return new URL(url).hostname } catch { return url }
  }

  const getSupportedNuts = (data: MintInfoData | null): string[] => {
    if (!data?.nuts) return []
    return Object.keys(data.nuts).filter((k) => /^\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b))
  }

  const mints = settings.mints
  const emptySlots = LIMITS.MAX_MINTS - mints.length

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
        <button onClick={onBack} aria-label={t('common.back')} className="p-1">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h2 className="text-base font-semibold tracking-tight flex-1">{t('settings.manageMints')}</h2>
        {/* Slot indicator */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-foreground-muted mr-0.5">
            {mints.length}/{LIMITS.MAX_MINTS}
          </span>
          {mints.map((url) => (
            <button
              key={url}
              onClick={() => setExpandedMint(url)}
              className="w-6 h-6 rounded-sm overflow-hidden shrink-0"
            >
              <MintIcon url={url} getIconUrl={getIconUrl} size="sm" className="w-6 h-6" />
            </button>
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <div
              key={`empty-${i}`}
              className="w-6 h-6 rounded-sm border border-dashed border-foreground/20 shrink-0"
            />
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-safe">
        <div className="bg-background-card divide-y divide-border">
          {/* Filled slots */}
          {mints.map((url) => {
            const isExpanded = expandedMint === url
            const balance = getMintBalance(url)
            const status = getCachedStatus(url)
            const rawInfo = mintInfoCache[url]
            const isLoading = rawInfo === 'loading'
            const infoData = rawInfo === 'loading' ? undefined : rawInfo

            return (
              <div key={url}>
                {/* Mint row */}
                <button
                  onClick={() => handleToggle(url)}
                  className="w-full px-4 py-3 flex items-center gap-3 active:bg-background-hover text-left"
                >
                  <MintIcon url={url} getIconUrl={getIconUrl} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {getDisplayName(url)}
                      </span>
                      {status && (
                        <span className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          status.isOnline ? 'bg-accent-primary' : 'bg-accent-danger'
                        )} />
                      )}
                    </div>
                    <span className="text-[11px] text-foreground-muted truncate block">
                      {formatMintUrl(url)}
                    </span>
                  </div>
                  <span className="text-[13px] font-semibold text-foreground shrink-0">
                    {formatSats(balance)}
                  </span>
                  <ChevronDown className={cn(
                    'w-4 h-4 text-foreground-muted transition-transform shrink-0',
                    isExpanded && 'rotate-180'
                  )} />
                </button>

                {/* Accordion detail */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-2">
                      {/* All mint details in one card */}
                      <div className="bg-foreground/[0.03] rounded-sm px-3">
                        {/* Balance */}
                        <div className="flex justify-between items-center py-3">
                          <span className="text-[13px] font-medium text-foreground">{t('common.balance')}</span>
                          <div className="text-right">
                            <span className="text-[14px] font-semibold text-foreground">{formatSats(balance)}</span>
                            {(() => { const f = formatFiat(balance); return f ? <p className="text-[11px] text-foreground-muted">{f}</p> : null })()}
                          </div>
                        </div>
                        <div className="border-t border-border/50" />
                        {/* URL */}
                        <div className="flex justify-between items-center py-3">
                          <span className="text-[13px] font-medium text-foreground">URL</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleCopy(url, `url-${url}`)}
                              className="flex items-center gap-1.5 text-[12px] font-mono text-foreground-muted active:opacity-60 max-w-[180px]"
                            >
                              <span className="truncate">{formatMintUrl(url)}</span>
                              {copiedField === `url-${url}`
                                ? <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                                : <Copy className="w-3.5 h-3.5 shrink-0" />}
                            </button>
                            <button
                              onClick={() => setQrUrl(url)}
                              className="p-1 active:opacity-60"
                            >
                              <QrCode className="w-4 h-4 text-foreground-muted" />
                            </button>
                          </div>
                        </div>

                        {/* Contacts & Pubkey — right after URL */}
                        {isLoading ? (
                          <div className="flex items-center justify-center py-6 border-t border-border">
                            <div className="w-4 h-4 border-2 border-foreground/10 border-t-foreground rounded-full animate-spin" />
                          </div>
                        ) : infoData ? (
                          <>
                            {infoData.contact && infoData.contact.length > 0 && (
                              <>
                                <div className="border-t border-border/50" />
                                {infoData.contact.map((c, i) => (
                                  <div key={i}>
                                    {i > 0 && <div className="border-t border-border/50" />}
                                    <div className="flex justify-between items-center py-3 gap-2">
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <ExternalLink className="w-3.5 h-3.5 text-foreground-muted" />
                                        <span className="text-[13px] font-medium text-foreground">{c.method}</span>
                                      </div>
                                      <button
                                        onClick={() => handleCopy(c.info, `contact-${i}-${url}`)}
                                        className="flex items-center gap-1.5 text-[12px] font-mono text-foreground-muted active:opacity-60 min-w-0"
                                      >
                                        <span className="truncate">{c.info}</span>
                                        {copiedField === `contact-${i}-${url}`
                                          ? <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                                          : <Copy className="w-3.5 h-3.5 shrink-0" />}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}
                            {infoData.pubkey && (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="flex justify-between items-start py-3 gap-2">
                                  <span className="text-[13px] font-medium text-foreground shrink-0">Pubkey</span>
                                  <button
                                    onClick={() => handleCopy(infoData.pubkey!, `pubkey-${url}`)}
                                    className="flex items-start gap-1.5 active:opacity-60 min-w-0"
                                  >
                                    <p className="text-[11px] font-mono text-foreground break-all opacity-70 text-right">{infoData.pubkey}</p>
                                    {copiedField === `pubkey-${url}`
                                      ? <Check className="w-3.5 h-3.5 text-accent-primary shrink-0 mt-0.5" />
                                      : <Copy className="w-3.5 h-3.5 text-foreground-muted shrink-0 mt-0.5" />}
                                  </button>
                                </div>
                              </>
                            )}
                            {/* Server Info */}
                            {infoData.version && (
                              <>
                                <div className="border-t border-border" />
                                <div className="flex justify-between items-center py-3">
                                  <span className="text-[13px] font-medium text-foreground">Version</span>
                                  <button
                                    onClick={() => handleCopy(infoData.version!, `version-${url}`)}
                                    className="flex items-center gap-1.5 text-[12px] text-foreground active:opacity-60"
                                  >
                                    <span>{infoData.version}</span>
                                    {copiedField === `version-${url}`
                                      ? <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                                      : <Copy className="w-3.5 h-3.5 text-foreground-muted shrink-0" />}
                                  </button>
                                </div>
                              </>
                            )}
                            {infoData.description && (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="flex justify-between items-start py-3 gap-4">
                                  <span className="text-[13px] font-medium text-foreground shrink-0">{t('mintDetails.description')}</span>
                                  <p className="text-[12px] text-foreground/80 text-right leading-relaxed">{infoData.description}</p>
                                </div>
                              </>
                            )}
                            {infoData.motd && (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="flex justify-between items-start py-3 gap-4">
                                  <span className="text-[13px] font-medium text-foreground shrink-0">{t('mintDetails.motd')}</span>
                                  <p className="text-[12px] text-foreground/80 text-right leading-relaxed">{infoData.motd}</p>
                                </div>
                              </>
                            )}
                            {getSupportedNuts(infoData).length > 0 && (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="py-3">
                                  <span className="text-[13px] font-medium text-foreground">{t('mintDetails.supportedNuts')}</span>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {getSupportedNuts(infoData).map((nut) => (
                                      <span key={nut} className="px-1.5 py-0.5 bg-foreground/[0.06] text-foreground text-[11px] rounded-sm">
                                        <span className="font-mono opacity-60">{nut.padStart(2, '0')}</span>
                                        <span className="mx-0.5">·</span>
                                        {getNutName(nut)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </>
                            )}
                          </>
                        ) : infoData === null ? (
                          <div className="py-3 border-t border-border">
                            <p className="text-[12px] text-foreground-muted text-center">
                              {t('mintDetails.loadError')}
                            </p>
                          </div>
                        ) : null}

                        {/* Delete — inside card, separated */}
                        <div className="border-t border-border" />
                        <button
                          onClick={() => handleRemoveMint(url)}
                          className="w-full flex items-center justify-center gap-1.5 py-3 active:opacity-60"
                        >
                          <Trash2 className="w-4 h-4 text-accent-danger" />
                          <span className="text-[13px] font-semibold text-accent-danger">{t('mintDetails.deleteMint')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }, (_, i) => (
            <button
              key={`add-${i}`}
              onClick={onAddMint}
              className="w-full px-4 py-3 flex items-center gap-3 active:bg-background-hover text-left"
            >
              <div className="w-8 h-8 rounded-sm border border-dashed border-foreground/20 flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 text-foreground-muted" />
              </div>
              <span className="text-[13px] text-foreground-muted">{t('settings.addMint')}</span>
            </button>
          ))}
        </div>
      </div>

      {/* QR Code Modal */}
      <MintUrlQrModal
        isOpen={!!qrUrl}
        url={qrUrl || ''}
        onClose={() => setQrUrl(null)}
      />

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!mintToDelete} onClose={() => setMintToDelete(null)} title={t('settings.deleteMint')}>
        <div className="py-4 space-y-4">
          <div className="text-center space-y-1">
            <p className="text-[16px] font-semibold text-accent-primary">
              {getDisplayName(mintToDelete || '')}
            </p>
            {(() => {
              const url = mintToDelete || ''
              const normalized = url.endsWith('/') ? url.slice(0, -1) : url
              const balance = balanceByMint[normalized] || balanceByMint[url] || 0
              return balance > 0 ? (
                <>
                  <p className="text-[14px] text-foreground">
                    {t('settings.confirmDeleteMint')}
                  </p>
                  <p className="text-[13px] text-foreground-muted mt-2">
                    <Trans
                      i18nKey="settings.mintHasBalance"
                      values={{ formattedBalance: formatSats(balance) }}
                      components={{ bold: <strong className="font-semibold text-foreground" /> }}
                    />
                  </p>
                  <p className="text-[13px] text-accent-danger font-semibold">{t('settings.deleteWarning')}</p>
                </>
              ) : (
                <p className="text-[14px] text-foreground">
                  {t('settings.confirmDeleteMint')}
                </p>
              )
            })()}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMintToDelete(null)}
              className="flex-1 py-2.5 rounded-sm bg-background text-foreground font-semibold text-[13px] active:opacity-80 border border-border"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={confirmRemoveMint}
              className="flex-1 py-2.5 rounded-sm bg-accent-danger text-white font-semibold text-[13px] active:opacity-80"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default MintManagementScreen
