import { useState, useCallback, useEffect } from 'react'
import { ArrowLeft, Trash2, Info, Copy, Check, AlertTriangle, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useFormatSats, useFormatFiat } from '@/utils/format'

export interface MintInfo {
  url: string
  name?: string
  balance: number
  isOnline?: boolean
}

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

export interface MintDetailsModalProps {
  isOpen: boolean
  mint: MintInfo | null
  onClose: () => void
  onDelete?: (url: string) => void
}

// NUT names mapping (outside component to avoid re-creation)
const NUT_NAMES: Record<string, string> = {
  '0': 'Cryptography',
  '1': 'Mint Keys',
  '2': 'Keysets',
  '3': 'Swap',
  '4': 'Mint (Lightning)',
  '5': 'Melt (Lightning)',
  '6': 'Mint Info',
  '7': 'State Check',
  '8': 'Fee Return',
  '9': 'Restore',
  '10': 'Spending Conditions',
  '11': 'P2PK',
  '12': 'DLEQ Proofs',
  '13': 'Deterministic Secrets',
  '14': 'HTLC',
  '15': 'MPP',
  '17': 'WebSocket',
  '18': 'Payment Request',
  '19': 'Cached Responses',
  '20': 'Signature on Quote',
}

const getNutName = (nut: string): string => {
  return NUT_NAMES[nut] || `NUT-${nut.padStart(2, '0')}`
}

export function MintDetailsModal({
  isOpen,
  mint,
  onClose,
  onDelete,
}: MintDetailsModalProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const [copied, setCopied] = useState(false)
  const [copiedContact, setCopiedContact] = useState<number | null>(null)
  const [copiedPubkey, setCopiedPubkey] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [mintInfoData, setMintInfoData] = useState<MintInfoData | null>(null)
  const [isLoadingInfo, setIsLoadingInfo] = useState(false)
  const [showMintInfo, setShowMintInfo] = useState(false)

  const isOnline = mint?.isOnline ?? false

  // Fetch mint info when modal opens
  useEffect(() => {
    if (isOpen && mint?.url) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoadingInfo(true)
      setMintInfoData(null)
      fetch(`${mint.url.replace(/\/$/, '')}/v1/info`)
        .then((res) => res.json())
        .then((data) => {
          setMintInfoData(data)
        })
        .catch((err) => {
          console.warn('[MintDetailsModal] Failed to fetch mint info:', err)
        })
        .finally(() => {
          setIsLoadingInfo(false)
        })
    }
  }, [isOpen, mint])

  const handleCopy = useCallback(async () => {
    if (!mint?.url) return
    try {
      await navigator.clipboard.writeText(mint.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = mint.url
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [mint])

  const handleCopyContact = useCallback(async (info: string, index: number) => {
    try {
      await navigator.clipboard.writeText(info)
      setCopiedContact(index)
      setTimeout(() => setCopiedContact(null), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = info
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopiedContact(index)
      setTimeout(() => setCopiedContact(null), 2000)
    }
  }, [])

  const handleCopyPubkey = useCallback(async () => {
    if (!mintInfoData?.pubkey) return
    try {
      await navigator.clipboard.writeText(mintInfoData.pubkey)
      setCopiedPubkey(true)
      setTimeout(() => setCopiedPubkey(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = mintInfoData.pubkey
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopiedPubkey(true)
      setTimeout(() => setCopiedPubkey(false), 2000)
    }
  }, [mintInfoData])

  const handleDelete = useCallback(() => {
    if (showDeleteConfirm && mint?.url) {
      onDelete?.(mint.url)
      onClose()
    } else {
      setShowDeleteConfirm(true)
    }
  }, [showDeleteConfirm, mint, onDelete, onClose])


  const formatMintUrl = (url: string) => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  // Get supported NUTs as array
  const getSupportedNuts = (): string[] => {
    if (!mintInfoData?.nuts) return []
    return Object.keys(mintInfoData.nuts)
      .filter((key) => key.match(/^\d+$/))
      .sort((a, b) => parseInt(a) - parseInt(b))
  }

  // Reset state when closing
  const handleClose = useCallback(() => {
    setShowDeleteConfirm(false)
    setShowMintInfo(false)
    onClose()
  }, [onClose])

  if (!isOpen || !mint) return null

  return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center pointer-events-none">
          {/* Backdrop */}
          <div
            onClick={handleClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto animate-fadeIn"
          />

          {/* Modal */}
          <div
            className="bg-background w-full sm:w-[400px] sm:rounded-2xl rounded-t-2xl p-4 pointer-events-auto relative z-10 shadow-2xl pb-safe max-h-[85vh] overflow-y-auto animate-slideInUp"
          >
            {/* Drag Handle */}
            <div className="w-10 h-1 bg-primary/10 rounded-full mx-auto mb-4" />

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  {mintInfoData?.name || mint.name || formatMintUrl(mint.url)}
                </h2>
                <div
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold border',
                    isOnline
                      ? 'bg-accent-primary/10 text-accent-primary border-accent-primary/20'
                      : 'bg-accent-danger/10 text-accent-danger border-accent-danger/20'
                  )}
                >
                  {isOnline ? 'ONLINE' : 'OFFLINE'}
                </div>
              </div>
              <button
                onClick={handleClose}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-primary/5 rounded-full hover:bg-primary/10 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-foreground" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Basic Info Card */}
              <div className="bg-white/50 p-3 rounded-xl border border-white/60 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-foreground-muted">{t('common.balance')}</span>
                  <div className="text-right">
                    <span className="font-bold text-foreground">
                      {formatSats(mint.balance)}
                    </span>
                    {(() => { const f = formatFiat(mint.balance); return f ? (
                      <p className="text-[10px] text-foreground-muted">{f}</p>
                    ) : null })()}
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-foreground-muted">URL</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 text-xs font-mono text-foreground bg-primary/5 px-2 py-1 rounded hover:bg-primary/10 transition-colors max-w-[200px]"
                  >
                    <span className="truncate">{formatMintUrl(mint.url)}</span>
                    {copied ? (
                      <Check className="w-3 h-3 text-accent-primary shrink-0" />
                    ) : (
                      <Copy className="w-3 h-3 shrink-0" />
                    )}
                  </button>
                </div>
              </div>

              {/* Mint Info Section (Expandable) */}
              <div className="bg-white/30 rounded-xl border border-white/50 overflow-hidden">
                <button
                  onClick={() => setShowMintInfo(!showMintInfo)}
                  className="w-full flex items-center justify-between p-3 hover:bg-white/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-foreground">
                      <Info className="w-3.5 h-3.5" />
                    </div>
                    <span className="font-bold text-foreground text-xs">{t('mintDetails.mintInfo')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoadingInfo && (
                      <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    )}
                    <ChevronDown
                      className={cn(
                        'w-4 h-4 text-foreground-muted transition-transform',
                        showMintInfo && 'rotate-180'
                      )}
                    />
                  </div>
                </button>

                {showMintInfo && (
                    <div
                      className="overflow-hidden animate-fadeIn"
                    >
                      <div className="px-3 pb-3 space-y-2 border-t border-white/30 pt-2">
                        {mintInfoData ? (
                          <>
                            {/* Description */}
                            {mintInfoData.description && (
                              <div>
                                <span className="text-[10px] font-bold text-foreground-muted uppercase">{t('mintDetails.description')}</span>
                                <p className="text-xs text-foreground mt-0.5">{mintInfoData.description}</p>
                              </div>
                            )}

                            {/* MOTD */}
                            {mintInfoData.motd && (
                              <div className="bg-primary/5 p-2 rounded-lg">
                                <span className="text-[10px] font-bold text-foreground-muted uppercase">{t('mintDetails.motd')}</span>
                                <p className="text-xs text-foreground mt-0.5">{mintInfoData.motd}</p>
                              </div>
                            )}

                            {/* Supported NUTs */}
                            {getSupportedNuts().length > 0 && (
                              <div>
                                <span className="text-[10px] font-bold text-foreground-muted uppercase">{t('mintDetails.supportedNuts')}</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {getSupportedNuts().map((nut) => (
                                    <span
                                      key={nut}
                                      className="px-1.5 py-0.5 bg-primary/10 text-foreground text-[10px] rounded"
                                    >
                                      <span className="font-mono opacity-60">{nut.padStart(2, '0')}</span>
                                      <span className="mx-0.5">·</span>
                                      {getNutName(nut)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Contact */}
                            {mintInfoData.contact && mintInfoData.contact.length > 0 && (
                              <div>
                                <span className="text-[10px] font-bold text-foreground-muted uppercase">{t('mintDetails.contact')}</span>
                                <div className="space-y-1.5 mt-1">
                                  {mintInfoData.contact.map((c, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2">
                                      <div className="text-xs text-foreground min-w-0">
                                        <span className="font-medium">{c.method}:</span>{' '}
                                        <span className="font-mono text-[10px] break-all">{c.info}</span>
                                      </div>
                                      <button
                                        onClick={() => handleCopyContact(c.info, i)}
                                        className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-primary/5 rounded hover:bg-primary/10 transition-colors shrink-0"
                                      >
                                        {copiedContact === i ? (
                                          <Check className="w-3 h-3 text-accent-primary" />
                                        ) : (
                                          <Copy className="w-3 h-3 text-foreground-muted" />
                                        )}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Pubkey */}
                            {mintInfoData.pubkey && (
                              <div>
                                <span className="text-[10px] font-bold text-foreground-muted uppercase">Pubkey</span>
                                <div className="flex items-start justify-between gap-2 mt-0.5">
                                  <p className="text-[10px] font-mono text-foreground break-all opacity-70">
                                    {mintInfoData.pubkey}
                                  </p>
                                  <button
                                    onClick={handleCopyPubkey}
                                    className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-primary/5 rounded hover:bg-primary/10 transition-colors shrink-0"
                                  >
                                    {copiedPubkey ? (
                                      <Check className="w-3 h-3 text-accent-primary" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-foreground-muted" />
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-foreground-muted text-center py-2">
                            {isLoadingInfo ? t('mintDetails.loadingInfo') : t('mintDetails.loadError')}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* Actions */}
              <div className="space-y-2">
                {onDelete && (
                  <button
                    onClick={handleDelete}
                    className={cn(
                      'w-full flex items-center justify-between p-3 rounded-xl transition-colors mt-3',
                      showDeleteConfirm
                        ? 'bg-accent-danger text-white'
                        : 'bg-accent-danger/10 hover:bg-accent-danger/20'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'w-7 h-7 rounded-full flex items-center justify-center',
                          showDeleteConfirm
                            ? 'bg-white/20 text-white'
                            : 'bg-accent-danger/20 text-accent-danger'
                        )}
                      >
                        {showDeleteConfirm ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <span
                        className={cn(
                          'font-bold text-xs',
                          showDeleteConfirm ? 'text-white' : 'text-accent-danger'
                        )}
                      >
                        {showDeleteConfirm ? t('mintDetails.deleteConfirm') : t('mintDetails.deleteMint')}
                      </span>
                    </div>
                  </button>
                )}
              </div>

              {/* Warning for non-empty balance */}
              {mint.balance > 0 && showDeleteConfirm && (
                <div className="bg-accent-warning-bright/10 text-accent-warning-bright-text p-3 rounded-xl text-xs font-medium flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>
                    {t('mintDetails.balanceWarning', { formattedAmount: formatSats(mint.balance) })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
  )
}
