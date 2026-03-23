import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Copy, Check, QrCode, ExternalLink, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { MintInfo, MintInfoData } from '@/core/types'
import { NUT_NAMES, getSupportedNuts } from '@/core/constants'
import { formatMintHost } from '@/utils/url'
import { isDuplicateMintName } from './mintNameUtils'
import { MintUrlQrModal } from './MintUrlQrModal'
import { SupportedNutsModal } from './SupportedNutsModal'
import { DeleteMintSheet } from './DeleteMintSheet'

export interface MintInfoSheetProps {
  isOpen: boolean
  mint: MintInfo | null
  onClose: () => void
  onDelete?: (url: string) => void
  onRename?: (url: string, newName: string) => void
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

export function MintInfoSheet({ isOpen, mint, onClose, onDelete, onRename, getDisplayName }: MintInfoSheetProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const [mintInfo, setMintInfo] = useState<MintInfoData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [showNuts, setShowNuts] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editNameValue, setEditNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Fetch mint info
  const fetchMintInfo = useCallback(async (url: string) => {
    setIsLoading(true)
    setMintInfo(null)
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/v1/info`)
      const data = await res.json()
      setMintInfo(data)
    } catch (err) {
      console.warn('[MintInfoSheet] fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !mint?.url) return
    fetchMintInfo(mint.url)
  }, [isOpen, mint?.url, fetchMintInfo])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  const handleStartEditName = useCallback(() => {
    setEditNameValue(mint?.alias || mint?.name || '')
    setIsEditingName(true)
    setTimeout(() => nameInputRef.current?.focus(), 50)
  }, [mint?.alias, mint?.name])

  const handleSaveName = useCallback(() => {
    if (!mint?.url) return
    const trimmed = editNameValue.trim()
    if (trimmed && onRename) {
      if (isDuplicateMintName(trimmed, mint.url, settings.mints, getDisplayName)) {
        addToast({ type: 'error', message: t('mintDetail.duplicateName'), duration: 3000 })
        return
      }
      onRename(mint.url, trimmed)
    }
    setIsEditingName(false)
  }, [mint?.url, editNameValue, onRename, settings.mints, getDisplayName, addToast, t])

  if (!isOpen || !mint) return null

  const aliasName = mint.alias || mint.name || formatMintHost(mint.url)
  const originalMintName = mintInfo?.name || mint.mintName
  const nuts = getSupportedNuts(mintInfo?.nuts)

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none">
        {/* Backdrop */}
        <div
          onClick={onClose}
          className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto animate-fadeIn"
        />

        {/* Sheet */}
        <div className="bg-background w-full rounded-t-2xl pointer-events-auto relative z-10 shadow-2xl pb-safe max-h-[90vh] overflow-y-auto animate-slideInUp">
          {/* Header */}
          <div className="sticky top-0 bg-background z-10 flex items-center justify-between px-4 py-4 border-b border-border">
            <div className="w-9" />
            <h2 className="text-subtitle text-foreground">
              {t('mintDetail.mintInfo')}
            </h2>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-muted"
            >
              <X className="w-4 h-4 text-foreground" />
            </button>
          </div>

          <div className="px-6 py-6 space-y-6">
            {/* Mint Icon + Name */}
            <div className="flex flex-col items-center gap-2">
              {mint.iconUrl ? (
                <img src={mint.iconUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                  <span className="text-subtitle text-foreground-muted">{aliasName[0]?.toUpperCase()}</span>
                </div>
              )}
              {isEditingName ? (
                <div className="flex flex-col items-center gap-1">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value.slice(0, 10))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                    onBlur={handleSaveName}
                    placeholder={t('mintDetail.namePlaceholder')}
                    maxLength={10}
                    className="text-title text-foreground text-center bg-muted rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-primary/30 w-48"
                  />
                  <span className="text-overline text-foreground-muted">{editNameValue.length}/10</span>
                </div>
              ) : (
                <button
                  onClick={handleStartEditName}
                  className="flex items-center gap-1.5 group"
                >
                  <p className="text-title text-foreground">{aliasName}</p>
                  <Pencil className="w-3.5 h-3.5 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
              {originalMintName && originalMintName !== aliasName && (
                <p className="text-label text-foreground-muted">{originalMintName}</p>
              )}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-border border-t-foreground-muted rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Announcement (MOTD) */}
                {mintInfo?.motd && (
                  <InfoCard label={t('mintDetail.announcement')}>
                    <p className="text-caption text-foreground">{mintInfo.motd}</p>
                  </InfoCard>
                )}

                {/* Description */}
                {mintInfo?.description && (
                  <InfoCard label={t('mintDetail.description')}>
                    <p className="text-caption text-foreground">{mintInfo.description}</p>
                    {mintInfo.description_long && (
                      <p className="text-caption text-foreground-muted mt-1">{mintInfo.description_long}</p>
                    )}
                  </InfoCard>
                )}

                {/* Mint URL */}
                <div>
                  <p className="text-overline uppercase tracking-wide text-foreground-muted mb-2">
                    {t('mintDetail.mintUrl')}
                  </p>
                  <div className="bg-input rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                    <span className="text-caption font-mono text-foreground truncate">{mint.url}</span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleCopy(mint.url, 'url')}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-card border border-border"
                      >
                        {copiedField === 'url' ? (
                          <Check className="w-4 h-4 text-accent-success" />
                        ) : (
                          <Copy className="w-4 h-4 text-foreground-muted" />
                        )}
                      </button>
                      <button
                        onClick={() => setShowQr(true)}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-background-card border border-border"
                      >
                        <QrCode className="w-4 h-4 text-foreground-muted" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Contact */}
                {mintInfo?.contact && mintInfo.contact.length > 0 && (
                  <div>
                    <p className="text-overline uppercase tracking-wide text-foreground-muted mb-2">
                      {t('mintDetail.mintContact')}
                    </p>
                    <div className="bg-input rounded-xl overflow-hidden">
                      {mintInfo.contact.map((c, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center justify-between px-4 py-3',
                            i > 0 && 'border-t border-border'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <ExternalLink className="w-4 h-4 text-foreground-muted shrink-0" />
                            <div className="min-w-0">
                              <p className="text-label text-foreground-muted font-medium">{c.method}</p>
                              <p className="text-caption text-foreground truncate">{c.info}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCopy(c.info, `contact-${i}`)}
                            className="w-9 h-9 flex items-center justify-center shrink-0"
                          >
                            {copiedField === `contact-${i}` ? (
                              <Check className="w-4 h-4 text-accent-success" />
                            ) : (
                              <Copy className="w-4 h-4 text-foreground-muted" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Details Section */}
                <div>
                  <p className="text-overline uppercase tracking-wide text-foreground-muted mb-2">
                    {t('mintDetail.details')}
                  </p>
                  <div className="bg-input rounded-xl overflow-hidden">
                    {/* Version */}
                    {mintInfo?.version && (
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-caption text-foreground-muted">{t('mintDetail.version')}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-caption font-mono text-foreground">{mintInfo.version}</span>
                          <button
                            onClick={() => handleCopy(mintInfo.version!, 'version')}
                            className="w-7 h-7 flex items-center justify-center"
                          >
                            {copiedField === 'version' ? (
                              <Check className="w-3.5 h-3.5 text-accent-success" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-foreground-muted" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Units */}
                    {mintInfo?.units && mintInfo.units.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-caption text-foreground-muted">{t('mintDetail.units')}</span>
                        <span className="text-caption text-foreground">{mintInfo.units.join(', ')}</span>
                      </div>
                    )}

                    {/* Supported Protocols */}
                    {nuts.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                        <span className="text-caption text-foreground-muted">{t('mintDetail.supportedProtocols')}</span>
                        <button
                          onClick={() => setShowNuts(true)}
                          className="text-caption text-brand font-medium"
                        >
                          {t('mintDetail.viewAll')}
                        </button>
                      </div>
                    )}

                    {/* Pubkey */}
                    {mintInfo?.pubkey && (
                      <div className="px-4 py-3 border-t border-border">
                        <div className="flex items-center justify-between">
                          <span className="text-caption text-foreground-muted">Pubkey</span>
                          <button
                            onClick={() => handleCopy(mintInfo.pubkey!, 'pubkey')}
                            className="w-7 h-7 flex items-center justify-center"
                          >
                            {copiedField === 'pubkey' ? (
                              <Check className="w-3.5 h-3.5 text-accent-success" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-foreground-muted" />
                            )}
                          </button>
                        </div>
                        <p className="text-label font-mono text-foreground-muted break-all mt-1">
                          {mintInfo.pubkey}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Danger Zone */}
                {onDelete && (
                  <div>
                    <p className="text-overline uppercase tracking-wide text-foreground-muted mb-2">
                      {t('mintDetail.dangerZone')}
                    </p>
                    <button
                      onClick={() => setShowDelete(true)}
                      className="w-full bg-accent-danger text-white rounded-xl py-4 font-semibold text-caption hover:bg-accent-danger/90 transition-colors"
                    >
                      {t('mintDetail.emptyAndDelete')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-modals */}
      <MintUrlQrModal
        isOpen={showQr}
        url={mint.url}
        onClose={() => setShowQr(false)}
      />
      <SupportedNutsModal
        isOpen={showNuts}
        nuts={nuts}
        nutNames={NUT_NAMES}
        onClose={() => setShowNuts(false)}
      />
      {showDelete && (
        <DeleteMintSheet
          isOpen={showDelete}
          mint={mint}
          onClose={() => setShowDelete(false)}
          onDelete={(url) => {
            onDelete?.(url)
          }}
        />
      )}
    </>
  )
}

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-input rounded-xl px-4 py-3">
      <p className="text-label text-foreground-muted uppercase mb-1">{label}</p>
      {children}
    </div>
  )
}
