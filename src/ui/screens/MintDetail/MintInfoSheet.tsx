import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, QrCode, ExternalLink, Pencil, Palette, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/lib/utils'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { CARD_PRESET_VARIANTS, MintCard, VARIANT_HEX, resolveMintColor } from '@/ui/components/wallet/MintCard'
import type { MintCardDesignPreset, MintInfo, MintInfoData } from '@/core/types'
import { LIMITS, NUT_NAMES, getSupportedNuts } from '@/core/constants'
import { isDuplicateMintName } from '@/utils/mint-name'
import { formatMintHost } from '@/utils/url'
import { MintUrlQrModal } from './MintUrlQrModal'
import { SupportedNutsModal } from './SupportedNutsModal'
import { DeleteMintSheet } from './DeleteMintSheet'

export interface MintInfoSheetProps {
  isOpen: boolean
  /** Which half of the sheet to show — card customization vs mint information. */
  section: 'settings' | 'info'
  mint: MintInfo | null
  onClose: () => void
  onDelete?: (url: string) => Promise<void>
  onRename?: (url: string, newName: string) => void
  onChangeColor?: (url: string, color: string) => void
  onChangeCardDesign?: (url: string, preset: MintCardDesignPreset) => void
  getDisplayName: (url: string) => string
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function MintInfoSheet({
  isOpen,
  section,
  mint,
  onClose,
  onDelete,
  onRename,
  onChangeColor,
  onChangeCardDesign,
  getDisplayName,
}: MintInfoSheetProps) {
  const { t } = useTranslation()
  const registry = useServiceRegistry()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const [mintInfo, setMintInfo] = useState<MintInfoData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [showNuts, setShowNuts] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  // Inline name editing
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const lastFetchedUrl = useRef<string | null>(null)

  // mintInfo facade instead of a direct /v1/info fetch: 24h cache hit = no
  // network, miss goes through Coco (limiter-protected)
  const fetchMintInfo = useCallback(async (url: string) => {
    if (lastFetchedUrl.current === url && mintInfo) return
    setIsLoading(true)
    try {
      const data = await registry.mintInfo.getInfo(url)
      setMintInfo(data)
      lastFetchedUrl.current = url
    } catch (err) {
      console.warn('[MintInfoSheet] fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [mintInfo, registry])

  useEffect(() => {
    // Only the info half renders network data — don't fetch for settings.
    if (!isOpen || section !== 'info' || !mint?.url) return
    fetchMintInfo(mint.url)
  }, [isOpen, section, mint?.url, fetchMintInfo])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    addToast({ type: 'success', message: t('toast.copied'), duration: 1500 })
    setTimeout(() => setCopiedField(null), 2000)
  }, [addToast, t])

  const handleStartEdit = useCallback(() => {
    setEditNameValue(mint?.alias || mint?.name || '')
    setNameError(null)
    setIsEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }, [mint?.alias, mint?.name])

  const handleSaveName = useCallback(() => {
    if (!mint?.url) return
    const trimmed = editNameValue.trim()
    if (!trimmed || trimmed === (mint.alias || mint.name)) {
      setNameError(null)
      setIsEditingName(false)
      return
    }

    if (isDuplicateMintName(trimmed, mint.url, settings.mints, getDisplayName)) {
      setNameError(t('mintDetail.duplicateName'))
      setTimeout(() => nameInputRef.current?.focus(), 0)
      return
    }

    if (onRename) {
      onRename(mint.url, trimmed)
    }
    setNameError(null)
    setIsEditingName(false)
  }, [mint?.url, mint?.alias, mint?.name, editNameValue, onRename, settings.mints, getDisplayName, t])

  if (!mint) return null

  const aliasName = mint.alias || mint.name || formatMintHost(mint.url)
  const originalMintName = mintInfo?.name || mint.mintName
  const nuts = getSupportedNuts(mintInfo?.nuts)
  const currentCardDesign = settings.mintCardDesignPresets?.[mint.url] ?? 'modern'
  const currentColor = settings.mintColors?.[mint.url]
  const customColor = currentColor?.startsWith('#') ? currentColor : null
  const effectiveColor = resolveMintColor(mint.url, settings.mints.indexOf(mint.url), settings.mintColors)
  const effectivePreset = customColor ? null : effectiveColor.variant

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={t(section === 'settings' ? 'nav.settings' : 'mintDetail.mintInfo')}
      >
        <div className="px-5 py-5 space-y-5">

          {section === 'settings' && (
          <>
          {/* Live card preview — edits land here immediately */}
          <div className="pointer-events-none flex justify-center" aria-hidden>
            <div className="origin-top scale-[0.78]" style={{ width: 'var(--card-w)' }}>
              <MintCard
                mint={{ ...mint, alias: isEditingName ? (editNameValue || aliasName) : aliasName }}
                variant={effectivePreset ?? effectiveColor.variant}
                customColor={customColor ?? undefined}
                hideBalance
              />
            </div>
          </div>

          {/* Card name — editable */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-caption font-medium text-foreground-muted">{t('mintDetail.cardName')}</p>
              <p className="text-overline text-foreground-muted/50">{(isEditingName ? editNameValue : aliasName).length}/{LIMITS.MAX_MINT_NAME_LENGTH}</p>
            </div>
            {isEditingName ? (
              <div className={cn(
                'flex items-center rounded-2xl border bg-background px-4 py-3 transition-colors',
                nameError ? 'border-accent-danger' : 'border-brand',
              )}>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editNameValue}
                  onChange={(e) => {
                    setEditNameValue(e.target.value.slice(0, LIMITS.MAX_MINT_NAME_LENGTH))
                    if (nameError) {
                      setNameError(null)
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                  onBlur={handleSaveName}
                  maxLength={LIMITS.MAX_MINT_NAME_LENGTH}
                  className="flex-1 bg-transparent text-body font-medium text-foreground focus:outline-none"
                />
              </div>
            ) : (
              <button
                onClick={handleStartEdit}
                className="flex w-full items-center gap-2 rounded-2xl border border-border/60 bg-background px-4 py-3 active:scale-[0.99] transition-transform"
              >
                <span className="text-body font-medium text-foreground flex-1 text-left truncate">{aliasName}</span>
                <Pencil className="w-4 h-4 text-foreground-muted shrink-0" />
              </button>
            )}
            {nameError && (
              <p className="mt-1 text-caption text-accent-danger">{nameError}</p>
            )}
          </div>

          {/* Card Color */}
          {onChangeColor && (
            <div>
              <p className="text-caption font-medium text-foreground-muted mb-2">{t('mintDetail.cardColor')}</p>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-background px-4 py-3.5">
                {CARD_PRESET_VARIANTS.map((v) => {
                  const hex = VARIANT_HEX[v]
                  const isActive = effectivePreset === v || currentColor === v || currentColor === hex
                  return (
                    <button
                      key={v}
                      onClick={() => onChangeColor(mint.url, v)}
                      className={cn(
                        'w-8 h-8 rounded-full transition-all active:scale-90',
                        isActive && 'ring-2 ring-offset-2 ring-foreground/40 ring-offset-background'
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  )
                })}
                <label
                  className={cn(
                    'relative w-8 h-8 rounded-full bg-gradient-to-br from-red-400 via-green-400 to-blue-400 cursor-pointer active:scale-90 transition-all flex items-center justify-center overflow-hidden',
                    customColor && !Object.values(VARIANT_HEX).includes(customColor) && 'ring-2 ring-offset-2 ring-foreground/40 ring-offset-background'
                  )}
                  style={customColor ? { background: customColor } : undefined}
                >
                  <Palette className="w-3.5 h-3.5 text-white drop-shadow-sm relative z-10" />
                  <input
                    type="color"
                    value={customColor || VARIANT_HEX[effectiveColor.variant] || '#515AC0'}
                    onChange={(e) => onChangeColor(mint.url, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Card Design */}
          {onChangeCardDesign && (
            <div>
              <p className="text-caption font-medium text-foreground-muted mb-2">{t('mintDetail.cardDesign')}</p>
              {/* Simple selection — the live preview above already shows the result */}
              <div className="grid grid-cols-2 gap-3">
                {(['classic', 'modern'] as const).map((preset) => {
                  const isActive = currentCardDesign === preset
                  return (
                    <button
                      key={preset}
                      onClick={() => onChangeCardDesign(mint.url, preset)}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-2xl border bg-background px-4 py-3.5 transition-all active:scale-[0.98]',
                        isActive ? 'border-brand ring-1 ring-brand/25' : 'border-border/60',
                      )}
                    >
                      <span className={cn('text-body font-semibold', isActive ? 'text-foreground' : 'text-foreground-muted')}>
                        {t(preset === 'classic' ? 'mintDetail.cardDesignClassic' : 'mintDetail.cardDesignModern')}
                      </span>
                      {isActive && <Check className="w-4 h-4 text-brand shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Delete — serious but quiet: outline row, not a filled block */}
          {onDelete && (
            <button
              onClick={() => setShowDelete(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-accent-danger/30 py-3.5 text-body font-semibold text-accent-danger active:scale-[0.98] transition-transform"
            >
              <Trash2 className="w-4 h-4" strokeWidth={1.8} />
              {t('mintDetail.emptyAndDelete')}
            </button>
          )}
          </>
          )}

          {section === 'info' && (isLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-border border-t-foreground-muted rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Hero — who this mint is */}
              <div className="flex flex-col items-center gap-1 pt-1 text-center">
                {mint.iconUrl ? (
                  <img src={mint.iconUrl} alt="" className="w-14 h-14 rounded-2xl object-cover" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-foreground/[0.06] flex items-center justify-center">
                    <span className="text-subtitle font-semibold text-foreground-muted">{(originalMintName || aliasName)[0]?.toUpperCase()}</span>
                  </div>
                )}
                <p className="mt-2 text-subtitle font-bold text-foreground">{originalMintName || formatMintHost(mint.url)}</p>
                <p className="text-caption text-foreground-muted">{formatMintHost(mint.url)}</p>
                {mintInfo?.motd && (
                  <p className="mt-2 w-full rounded-xl bg-background px-4 py-2.5 text-caption text-foreground-muted">
                    “{mintInfo.motd}”
                  </p>
                )}
              </div>

              {/* Facts */}
              <div className="rounded-2xl border border-border/60 bg-background px-4 divide-y divide-border/40">
                <div className="flex items-center justify-between py-3 gap-2">
                  <span className="text-caption text-foreground-muted shrink-0">URL</span>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-caption font-mono text-foreground truncate">{formatMintHost(mint.url)}</span>
                    <button onClick={() => handleCopy(mint.url, 'url')} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]">
                      {copiedField === 'url' ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                    </button>
                    <button onClick={() => setShowQr(true)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]">
                      <QrCode className="w-3.5 h-3.5 text-foreground-muted" />
                    </button>
                  </div>
                </div>
                {mintInfo?.version && (
                  <div className="flex items-center justify-between py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.version')}</span>
                    <span className="text-caption font-mono text-foreground">{mintInfo.version}</span>
                  </div>
                )}
                {mintInfo?.units && mintInfo.units.length > 0 && (
                  <div className="flex items-center justify-between py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.units')}</span>
                    <span className="text-caption text-foreground">{mintInfo.units.join(', ')}</span>
                  </div>
                )}
                {nuts.length > 0 && (
                  <button onClick={() => setShowNuts(true)} className="flex w-full items-center justify-between py-3 active:opacity-70">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.supportedProtocols')}</span>
                    <span className="text-caption text-brand font-medium">{t('mintDetail.viewAll')}</span>
                  </button>
                )}
              </div>

              {/* Description + contact + key */}
              {(mintInfo?.description || (mintInfo?.contact && mintInfo.contact.length > 0) || mintInfo?.pubkey) && (
                <div className="rounded-2xl border border-border/60 bg-background px-4 divide-y divide-border/40">
                  {mintInfo?.description && (
                    <div className="py-3">
                      <span className="text-caption text-foreground-muted">{t('mintDetail.description')}</span>
                      <p className="text-caption text-foreground mt-1">{mintInfo.description}</p>
                    </div>
                  )}
                  {mintInfo?.contact && mintInfo.contact.length > 0 && mintInfo.contact.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-3 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ExternalLink className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                        <span className="text-caption text-foreground truncate">{c.info}</span>
                      </div>
                      <button onClick={() => handleCopy(c.info, `contact-${i}`)} className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]">
                        {copiedField === `contact-${i}` ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                      </button>
                    </div>
                  ))}
                  {mintInfo?.pubkey && (
                    <div className="py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-caption text-foreground-muted">Pubkey</span>
                        <button onClick={() => handleCopy(mintInfo.pubkey!, 'pubkey')} className="w-7 h-7 flex items-center justify-center rounded-lg active:bg-foreground/[0.06]">
                          {copiedField === 'pubkey' ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                        </button>
                      </div>
                      <p className="text-overline font-mono text-foreground-muted break-all mt-1">{mintInfo.pubkey}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          ))}
        </div>
      </BottomSheet>

      <MintUrlQrModal isOpen={showQr} url={mint.url} onClose={() => setShowQr(false)} />
      <SupportedNutsModal isOpen={showNuts} nuts={nuts} nutNames={NUT_NAMES} onClose={() => setShowNuts(false)} />
      {showDelete && onDelete && (
        <DeleteMintSheet
          key={`${mint.url}-${showDelete ? 'open' : 'closed'}`}
          isOpen={showDelete}
          mint={mint}
          onClose={() => setShowDelete(false)}
          onDelete={onDelete}
        />
      )}
    </>
  )
}
