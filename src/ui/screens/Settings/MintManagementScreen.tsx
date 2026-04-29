import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, ChevronDown, Trash2, Copy, Check, QrCode, ExternalLink } from 'lucide-react'
import { Reorder } from 'motion/react'
import { Trans, useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useMintHealth } from '@/ui/hooks/use-mint-health'
import { LIMITS, getNutName, getSupportedNuts } from '@/core/constants'
import { formatMintHost, getMintBalance as getMintBalanceUtil } from '@/utils/url'
import type { MintInfoData } from '@/core/types'
// clearMintData provided via onClearMintData callback prop
import { cn } from '@/ui/primitives/utils'
import { Modal } from '@/ui/components/common'
import { MintIcon } from './SettingsHelpers'
import { MintUrlQrModal } from '@/ui/screens/MintDetail/MintUrlQrModal'
import { isSameOrder, moveItem, reconcileOrder } from '@/utils/reorder'
import { ReorderableSettingItem } from './ReorderableSettingItem'

export interface MintManagementScreenProps {
  onBack: () => void
  onAddMint: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
  onClearMintData?: (mintUrl: string) => Promise<void>
}

export function MintManagementScreen({
  onBack,
  onAddMint,
  onSaveSettings,
  onClearMintData,
}: MintManagementScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const balanceByMint = useAppStore((s) => s.balance.byMint)
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus, checkAllMints } = useMintHealth()

  const [expandedMint, setExpandedMint] = useState<string | null>(null)
  const [mintToDelete, setMintToDelete] = useState<string | null>(null)
  const [orderedMints, setOrderedMints] = useState(settings.mints)

  // Per-mint info cache: undefined = not fetched, 'loading' = in progress, object = data, null = error
  const [mintInfoCache, setMintInfoCache] = useState<Record<string, MintInfoData | null | 'loading'>>({})

  // QR modal
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // Copy states
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const mints = reconcileOrder(orderedMints, settings.mints)

  useEffect(() => { checkAllMints() }, [checkAllMints])

  // Ref to guard against duplicate fetches without causing callback identity changes
  const fetchedRef = useRef<Set<string>>(new Set())

  const fetchMintInfo = useCallback((url: string) => {
    if (fetchedRef.current.has(url)) return
    fetchedRef.current.add(url)
    setMintInfoCache((p) => ({ ...p, [url]: 'loading' }))
    fetch(`${url.replace(/\/$/, '')}/v1/info`)
      .then((res) => res.json())
      .then((data) => setMintInfoCache((p) => ({ ...p, [url]: data })))
      .catch(() => {
        fetchedRef.current.delete(url)
        setMintInfoCache((p) => ({ ...p, [url]: null }))
      })
  }, [])

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

  const persistMintOrder = useCallback(async (nextMints: string[]) => {
    if (isSameOrder(nextMints, settings.mints)) {
      return
    }

    try {
      await onSaveSettings({ mints: nextMints })
    } catch {
      setOrderedMints(settings.mints)
      addToast({ type: 'error', message: t('errors.unknownError') })
    }
  }, [settings.mints, onSaveSettings, addToast, t])

  const commitDraggedMintOrder = useCallback(async () => {
    await persistMintOrder(mints)
  }, [mints, persistMintOrder])

  const handleMoveMint = useCallback(async (url: string, direction: 'up' | 'down') => {
    const currentIndex = mints.indexOf(url)
    if (currentIndex < 0) {
      return
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const newMints = moveItem(mints, currentIndex, targetIndex)
    if (newMints === mints) {
      return
    }

    setOrderedMints(newMints)
    await persistMintOrder(newMints)
  }, [mints, persistMintOrder])

  const confirmRemoveMint = useCallback(async () => {
    if (!mintToDelete) return
    if (settings.mints.length <= LIMITS.MIN_MINTS) {
      setMintToDelete(null)
      return
    }
    const urlToDelete = mintToDelete
    setMintToDelete(null)
    if (expandedMint === urlToDelete) setExpandedMint(null)
    const newMints = settings.mints.filter((m) => m !== urlToDelete)
    try {
      await onSaveSettings({ mints: newMints })
      await onClearMintData?.(urlToDelete)
    } catch {
      addToast({ type: 'error', message: t('errors.unknownError') })
    }
  }, [mintToDelete, settings.mints, onSaveSettings, expandedMint, onClearMintData, addToast, t])

  const getBalance = (url: string) => getMintBalanceUtil(url, balanceByMint)

  const emptySlots = LIMITS.MAX_MINTS - mints.length
  const isAtMinimumMints = mints.length <= LIMITS.MIN_MINTS

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('settings.manageMints')}</h2>
        <span className="text-caption font-semibold font-mono z-10 tabular-nums text-foreground-muted">
          {mints.length}<span className="text-foreground-muted/50">/{LIMITS.MAX_MINTS}</span>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <p className="px-5 pb-2 text-overline font-medium text-foreground-muted">
          {t('settings.reorderHint')}
        </p>
        <Reorder.Group
          as="div"
          axis="y"
          values={mints}
          onReorder={setOrderedMints}
          className="bg-background-card divide-y divide-border"
        >
          {/* Filled slots */}
          {mints.map((url, index) => {
            const isExpanded = expandedMint === url
            const balance = getBalance(url)
            const status = getCachedStatus(url)
            const rawInfo = mintInfoCache[url]
            const isLoading = rawInfo === 'loading'
            const infoData = rawInfo === 'loading' ? undefined : rawInfo

            return (
              <ReorderableSettingItem
                key={url}
                value={url}
                dragTitle={`${t('settings.dragToReorder')} ${getDisplayName(url)}`}
                handleTestId="mint-drag-handle"
                onDragEnd={commitDraggedMintOrder}
                onMoveUp={() => handleMoveMint(url, 'up')}
                onMoveDown={() => handleMoveMint(url, 'down')}
                canMoveUp={index > 0}
                canMoveDown={index < mints.length - 1}
              >
                {(dragHandle) => (
              <div>
                {/* Mint row */}
                <div className="flex items-stretch">
                  {dragHandle}
                  <button
                    onClick={() => handleToggle(url)}
                    className="min-w-0 flex-1 pr-4 py-3 flex items-center gap-3 active:bg-background-hover text-left"
                  >
                    <MintIcon url={url} getIconUrl={getIconUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-caption font-medium text-foreground truncate">
                          {getDisplayName(url)}
                        </span>
                        {index === 0 && (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-overline font-semibold text-brand">
                            {t('settings.primary')}
                          </span>
                        )}
                        {status && (
                          <span className={cn(
                            'w-1.5 h-1.5 rounded-full shrink-0',
                            status.isOnline ? 'bg-accent-primary' : 'bg-accent-danger'
                          )} />
                        )}
                      </div>
                      <span className="text-label font-medium text-foreground-muted truncate block">
                        {formatMintHost(url)}
                      </span>
                    </div>
                    <span className="text-caption font-semibold text-foreground shrink-0">
                      {formatSats(balance)}
                    </span>
                    <ChevronDown className={cn(
                      'w-4 h-4 text-foreground-muted transition-transform shrink-0',
                      isExpanded && 'rotate-180'
                    )} />
                  </button>
                </div>

                {/* Accordion detail */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-out"
                  style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-2">
                      {/* All mint details in one card */}
                      <div className="bg-foreground/[0.03] rounded-xl px-4">
                        {/* Balance */}
                        <div className="flex justify-between items-center py-3">
                          <span className="text-caption font-medium text-foreground">{t('common.balance')}</span>
                          <div className="text-right">
                            <span className="text-body font-semibold text-foreground">{formatSats(balance)}</span>
                            {(() => { const f = formatFiat(balance); return f ? <p className="text-overline font-medium text-foreground-muted">{f}</p> : null })()}
                          </div>
                        </div>
                        <div className="border-t border-border/50" />
                        {/* URL */}
                        <div className="flex justify-between items-center py-3">
                          <span className="text-caption font-medium text-foreground">URL</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleCopy(url, `url-${url}`)}
                              className="flex items-center gap-1.5 text-label font-medium font-mono text-foreground-muted active:opacity-60 max-w-[180px]"
                            >
                              <span className="truncate">{formatMintHost(url)}</span>
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
                                        <span className="text-caption font-medium text-foreground">{c.method}</span>
                                      </div>
                                      <button
                                        onClick={() => handleCopy(c.info, `contact-${i}-${url}`)}
                                        className="flex items-center gap-1.5 text-label font-medium font-mono text-foreground-muted active:opacity-60 min-w-0"
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
                                  <span className="text-caption font-medium text-foreground shrink-0">Pubkey</span>
                                  <button
                                    onClick={() => handleCopy(infoData.pubkey!, `pubkey-${url}`)}
                                    className="flex items-start gap-1.5 active:opacity-60 min-w-0"
                                  >
                                    <p className="text-overline font-medium font-mono text-foreground break-all opacity-70 text-right">{infoData.pubkey}</p>
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
                                  <span className="text-caption font-medium text-foreground">Version</span>
                                  <button
                                    onClick={() => handleCopy(infoData.version!, `version-${url}`)}
                                    className="flex items-center gap-1.5 text-label font-medium text-foreground active:opacity-60"
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
                                  <span className="text-caption font-medium text-foreground shrink-0">{t('mintDetails.description')}</span>
                                  <p className="text-label font-medium text-foreground/80 text-right leading-relaxed">{infoData.description}</p>
                                </div>
                              </>
                            )}
                            {infoData.motd && (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="flex justify-between items-start py-3 gap-4">
                                  <span className="text-caption font-medium text-foreground shrink-0">{t('mintDetails.motd')}</span>
                                  <p className="text-label font-medium text-foreground/80 text-right leading-relaxed">{infoData.motd}</p>
                                </div>
                              </>
                            )}
                            {(() => {
                              const nuts = getSupportedNuts(infoData?.nuts)
                              return nuts.length > 0 ? (
                              <>
                                <div className="border-t border-border/50" />
                                <div className="py-3">
                                  <span className="text-caption font-medium text-foreground">{t('mintDetails.supportedNuts')}</span>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {nuts.map((nut) => (
                                      <span key={nut} className="px-1.5 py-0.5 bg-foreground/[0.06] text-foreground text-overline font-medium rounded-sm">
                                        <span className="font-mono opacity-60">{nut.padStart(2, '0')}</span>
                                        <span className="mx-0.5">·</span>
                                        {getNutName(nut)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </>
                            ) : null })()}
                          </>
                        ) : infoData === null ? (
                          <div className="py-3 border-t border-border">
                            <p className="text-label font-medium text-foreground-muted text-center">
                              {t('mintDetails.loadError')}
                            </p>
                          </div>
                        ) : null}

                        {/* Delete — inside card, separated */}
                        <div className="border-t border-border" />
                        {isAtMinimumMints ? (
                          <div className="w-full flex items-center justify-center gap-1.5 py-3">
                            <Trash2 className="w-4 h-4 text-foreground-muted/30" />
                            <span className="text-caption font-medium text-foreground-muted/50">{t('settings.minMintsRequired', { min: LIMITS.MIN_MINTS })}</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleRemoveMint(url)}
                            className="w-full flex items-center justify-center gap-1.5 py-3 active:opacity-60"
                          >
                            <Trash2 className="w-4 h-4 text-accent-danger" />
                            <span className="text-caption font-semibold text-accent-danger">{t('mintDetails.deleteMint')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                )}
              </ReorderableSettingItem>
            )
          })}
        </Reorder.Group>

        {emptySlots > 0 && (
        <div className="bg-background-card divide-y divide-border border-t border-border">
          {/* Empty slots */}
          {Array.from({ length: emptySlots }, (_, i) => (
            <button
              key={`add-${i}`}
              onClick={onAddMint}
              className="w-full px-4 py-3 flex items-center gap-3 active:bg-background-hover text-left"
            >
              <div className="w-8 h-8 rounded-lg border border-dashed border-foreground/20 flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 text-foreground-muted" />
              </div>
              <span className="text-caption text-foreground-muted">{t('settings.addMint')}</span>
            </button>
          ))}
        </div>
        )}
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
            <p className="text-subtitle font-semibold text-accent-primary">
              {getDisplayName(mintToDelete || '')}
            </p>
            {(() => {
              const balance = getBalance(mintToDelete || '')
              return balance > 0 ? (
                <>
                  <p className="text-body text-foreground">
                    {t('settings.confirmDeleteMint')}
                  </p>
                  <p className="text-caption text-foreground-muted mt-2">
                    <Trans
                      i18nKey="settings.mintHasBalance"
                      values={{ formattedBalance: formatSats(balance) }}
                      components={{ bold: <strong className="font-semibold text-foreground" /> }}
                    />
                  </p>
                  <p className="text-caption text-accent-danger font-semibold">{t('settings.deleteWarning')}</p>
                </>
              ) : (
                <p className="text-body text-foreground">
                  {t('settings.confirmDeleteMint')}
                </p>
              )
            })()}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setMintToDelete(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="lg" onClick={confirmRemoveMint} className="flex-1">
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default MintManagementScreen
