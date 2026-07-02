import { useState, useCallback, useEffect, useRef } from 'react'
import { Copy, Check, QrCode, ExternalLink, Pencil, Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/lib/utils'
import { Button } from '@/ui/components/common/Button'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { CARD_PRESET_VARIANTS, VARIANT_HEX, resolveMintColor } from '@/ui/components/wallet/MintCard'
import type { MintCardDesignPreset, MintInfo, MintInfoData } from '@/core/types'
import { LIMITS, NUT_NAMES, getSupportedNuts } from '@/core/constants'
import { isDuplicateMintName } from '@/utils/mint-name'
import { formatMintHost } from '@/utils/url'
import { MintUrlQrModal } from './MintUrlQrModal'
import { SupportedNutsModal } from './SupportedNutsModal'
import { DeleteMintSheet } from './DeleteMintSheet'

export interface MintInfoSheetProps {
  isOpen: boolean
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

  // 직접 /v1/info fetch → mintInfo facade (설계 §5): 24h 캐시 히트 시 네트워크 0,
  // 미스 시 Coco 경유(limiter 보호)
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
    if (!isOpen || !mint?.url) return
    fetchMintInfo(mint.url)
  }, [isOpen, mint?.url, fetchMintInfo])

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
      <BottomSheet isOpen={isOpen} onClose={onClose} title={t('mintDetail.mintInfo')}>
        <div className="px-5 py-5 space-y-5">

          {/* Mint identity — logo + original name */}
          <div className="flex items-center gap-3">
            {mint.iconUrl ? (
              <img src={mint.iconUrl} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
                <span className="text-body font-semibold text-foreground-muted">{(originalMintName || aliasName)[0]?.toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-body font-semibold text-foreground truncate">{originalMintName || formatMintHost(mint.url)}</p>
              <p className="text-caption text-foreground-muted truncate">{formatMintHost(mint.url)}</p>
            </div>
          </div>

          {/* Card name — editable */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-caption font-medium text-foreground-muted">{t('mintDetail.cardName')}</p>
              <p className="text-overline text-foreground-muted/50">{(isEditingName ? editNameValue : aliasName).length}/{LIMITS.MAX_MINT_NAME_LENGTH}</p>
            </div>
            {isEditingName ? (
              <div className="flex items-center border-b border-brand transition-colors">
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
                  className="flex-1 bg-transparent py-1.5 text-body font-medium text-foreground focus:outline-none"
                />
              </div>
            ) : (
              <button onClick={handleStartEdit} className="flex items-center gap-2 w-full border-b border-border py-1.5 active:opacity-70">
                <span className="text-body font-medium text-foreground flex-1 text-left truncate">{aliasName}</span>
                <Pencil className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
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
              <div className="flex items-center gap-2.5">
                {CARD_PRESET_VARIANTS.map((v) => {
                  const hex = VARIANT_HEX[v]
                  const isActive = effectivePreset === v || currentColor === v || currentColor === hex
                  return (
                    <button
                      key={v}
                      onClick={() => onChangeColor(mint.url, v)}
                      className={cn(
                        'w-7 h-7 rounded-full transition-all active:scale-90',
                        isActive && 'ring-2 ring-offset-2 ring-foreground/30 ring-offset-background'
                      )}
                      style={{ backgroundColor: hex }}
                    />
                  )
                })}
                <label
                  className={cn(
                    'relative w-7 h-7 rounded-full bg-gradient-to-br from-red-400 via-green-400 to-blue-400 cursor-pointer active:scale-90 transition-all flex items-center justify-center overflow-hidden',
                    customColor && !Object.values(VARIANT_HEX).includes(customColor) && 'ring-2 ring-offset-2 ring-foreground/30 ring-offset-background'
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
              <div className="grid grid-cols-2 gap-2">
                {(['classic', 'modern'] as const).map((preset) => {
                  const isActive = currentCardDesign === preset
                  return (
                    <button
                      key={preset}
                      onClick={() => onChangeCardDesign(mint.url, preset)}
                      className={cn(
                        'px-3 py-2.5 rounded-card border text-left transition-all active:scale-[0.98]',
                        isActive
                          ? 'border-foreground/30 bg-foreground/[0.04]'
                          : 'border-border bg-background-card',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-caption font-semibold text-foreground">
                          {t(preset === 'classic' ? 'mintDetail.cardDesignClassic' : 'mintDetail.cardDesignModern')}
                        </span>
                        {isActive && <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 border-2 border-border border-t-foreground-muted rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Info rows */}
              <div className="divide-y divide-border/50">
                {/* MOTD */}
                {mintInfo?.motd && (
                  <div className="py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.announcement')}</span>
                    <p className="text-caption text-foreground mt-1">{mintInfo.motd}</p>
                  </div>
                )}
                {/* URL */}
                <div className="flex items-center justify-between py-3 gap-2">
                  <span className="text-caption text-foreground-muted shrink-0">URL</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-caption font-mono text-foreground truncate">{mint.url}</span>
                    <button onClick={() => handleCopy(mint.url, 'url')} className="shrink-0 p-1">
                      {copiedField === 'url' ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                    </button>
                    <button onClick={() => setShowQr(true)} className="shrink-0 p-1">
                      <QrCode className="w-3.5 h-3.5 text-foreground-muted" />
                    </button>
                  </div>
                </div>

                {/* Version */}
                {mintInfo?.version && (
                  <div className="flex items-center justify-between py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.version')}</span>
                    <span className="text-caption font-mono text-foreground">{mintInfo.version}</span>
                  </div>
                )}

                {/* Description */}
                {mintInfo?.description && (
                  <div className="py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.description')}</span>
                    <p className="text-caption text-foreground mt-1">{mintInfo.description}</p>
                  </div>
                )}

                {/* Units */}
                {mintInfo?.units && mintInfo.units.length > 0 && (
                  <div className="flex items-center justify-between py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.units')}</span>
                    <span className="text-caption text-foreground">{mintInfo.units.join(', ')}</span>
                  </div>
                )}

                {/* Protocols */}
                {nuts.length > 0 && (
                  <div className="flex items-center justify-between py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.supportedProtocols')}</span>
                    <button onClick={() => setShowNuts(true)} className="text-caption text-brand font-medium">
                      {t('mintDetail.viewAll')}
                    </button>
                  </div>
                )}

                {/* Contact */}
                {mintInfo?.contact && mintInfo.contact.length > 0 && mintInfo.contact.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ExternalLink className="w-3.5 h-3.5 text-foreground-muted shrink-0" />
                      <span className="text-caption text-foreground truncate">{c.info}</span>
                    </div>
                    <button onClick={() => handleCopy(c.info, `contact-${i}`)} className="shrink-0 p-1">
                      {copiedField === `contact-${i}` ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                    </button>
                  </div>
                ))}

                {/* Pubkey */}
                {mintInfo?.pubkey && (
                  <div className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-caption text-foreground-muted">Pubkey</span>
                      <button onClick={() => handleCopy(mintInfo.pubkey!, 'pubkey')} className="p-1">
                        {copiedField === 'pubkey' ? <Check className="w-3.5 h-3.5 text-accent-success" /> : <Copy className="w-3.5 h-3.5 text-foreground-muted" />}
                      </button>
                    </div>
                    <p className="text-overline font-mono text-foreground-muted break-all mt-1">{mintInfo.pubkey}</p>
                  </div>
                )}
              </div>

              {/* Delete */}
              {onDelete && (
                <Button variant="destructive" size="lg" onClick={() => setShowDelete(true)} className="w-full">
                  {t('mintDetail.emptyAndDelete')}
                </Button>
              )}
            </>
          )}
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
