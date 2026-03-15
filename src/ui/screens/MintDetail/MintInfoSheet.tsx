import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Copy, Check, QrCode, ExternalLink, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { MintInfo } from '@/core/types'
import { MintUrlQrModal } from './MintUrlQrModal'
import { SupportedNutsModal } from './SupportedNutsModal'
import { DeleteMintSheet } from './DeleteMintSheet'

interface MintInfoData {
  name?: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: Array<{ method: string; info: string }>
  nuts?: Record<string, unknown>
  motd?: string
  units?: string[]
}

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

export interface MintInfoSheetProps {
  isOpen: boolean
  mint: MintInfo | null
  onClose: () => void
  onDelete?: (url: string) => void
  onRename?: (url: string, newName: string) => void
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

export function MintInfoSheet({ isOpen, mint, onClose, onDelete, onRename }: MintInfoSheetProps) {
  const { t } = useTranslation()
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
      onRename(mint.url, trimmed)
    }
    setIsEditingName(false)
  }, [mint?.url, editNameValue, onRename])

  const getSupportedNuts = (): string[] => {
    if (!mintInfo?.nuts) return []
    return Object.keys(mintInfo.nuts)
      .filter((k) => k.match(/^\d+$/))
      .sort((a, b) => parseInt(a) - parseInt(b))
  }

  const formatMintUrl = (url: string) => {
    try { return new URL(url).hostname } catch { return url }
  }

  if (!isOpen || !mint) return null

  const aliasName = mint.alias || mint.name || formatMintUrl(mint.url)
  const originalMintName = mintInfo?.name || mint.mintName
  const nuts = getSupportedNuts()

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none">
        {/* Backdrop */}
        <div
          onClick={onClose}
          className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto animate-fadeIn"
        />

        {/* Sheet */}
        <div className="bg-[#faf9f6] w-full rounded-t-2xl pointer-events-auto relative z-10 shadow-2xl pb-safe max-h-[90vh] overflow-y-auto animate-slideInUp">
          {/* Header */}
          <div className="sticky top-0 bg-[#faf9f6] z-10 flex items-center justify-between px-4 py-4 border-b border-gray-100">
            <div className="w-9" />
            <h2 className="font-['Outfit'] font-bold text-lg text-[#1d1d1f]">
              {t('mintDetail.mintInfo')}
            </h2>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100"
            >
              <X className="w-4 h-4 text-[#1d1d1f]" />
            </button>
          </div>

          <div className="px-6 py-6 space-y-6">
            {/* Mint Icon + Name */}
            <div className="flex flex-col items-center gap-2">
              {mint.iconUrl ? (
                <img src={mint.iconUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                  <span className="text-lg font-bold text-gray-400">{aliasName[0]?.toUpperCase()}</span>
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
                    className="font-['Outfit'] font-bold text-xl text-[#1d1d1f] text-center bg-gray-100 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-primary/30 w-48"
                  />
                  <span className="text-[11px] text-[#86868b]">{editNameValue.length}/10</span>
                </div>
              ) : (
                <button
                  onClick={handleStartEditName}
                  className="flex items-center gap-1.5 group"
                >
                  <p className="font-['Outfit'] font-bold text-xl text-[#1d1d1f]">{aliasName}</p>
                  <Pencil className="w-3.5 h-3.5 text-[#86868b] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
              {originalMintName && originalMintName !== aliasName && (
                <p className="text-xs text-[#86868b]">{originalMintName}</p>
              )}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
              </div>
            ) : (
              <>
                {/* Announcement (MOTD) */}
                {mintInfo?.motd && (
                  <InfoCard label={t('mintDetail.announcement')}>
                    <p className="text-sm text-[#1d1d1f]">{mintInfo.motd}</p>
                  </InfoCard>
                )}

                {/* Description */}
                {mintInfo?.description && (
                  <InfoCard label={t('mintDetail.description')}>
                    <p className="text-sm text-[#1d1d1f]">{mintInfo.description}</p>
                    {mintInfo.description_long && (
                      <p className="text-sm text-[#86868b] mt-1">{mintInfo.description_long}</p>
                    )}
                  </InfoCard>
                )}

                {/* Mint URL */}
                <div>
                  <p className="font-['Outfit'] font-semibold text-base text-[#1d1d1f] mb-2">
                    {t('mintDetail.mintUrl')}
                  </p>
                  <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                    <span className="text-sm font-mono text-[#1d1d1f] truncate">{mint.url}</span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleCopy(mint.url, 'url')}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-200"
                      >
                        {copiedField === 'url' ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-[#86868b]" />
                        )}
                      </button>
                      <button
                        onClick={() => setShowQr(true)}
                        className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-200"
                      >
                        <QrCode className="w-4 h-4 text-[#86868b]" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Contact */}
                {mintInfo?.contact && mintInfo.contact.length > 0 && (
                  <div>
                    <p className="font-['Outfit'] font-semibold text-base text-[#1d1d1f] mb-2">
                      {t('mintDetail.mintContact')}
                    </p>
                    <div className="bg-gray-50 rounded-xl overflow-hidden">
                      {mintInfo.contact.map((c, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center justify-between px-4 py-3',
                            i > 0 && 'border-t border-gray-100'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <ExternalLink className="w-4 h-4 text-[#86868b] shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs text-[#86868b] font-medium">{c.method}</p>
                              <p className="text-sm text-[#1d1d1f] truncate">{c.info}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleCopy(c.info, `contact-${i}`)}
                            className="w-9 h-9 flex items-center justify-center shrink-0"
                          >
                            {copiedField === `contact-${i}` ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4 text-[#86868b]" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Details Section */}
                <div>
                  <p className="font-['Outfit'] font-semibold text-base text-[#1d1d1f] mb-2">
                    {t('mintDetail.details')}
                  </p>
                  <div className="bg-gray-50 rounded-xl overflow-hidden">
                    {/* Version */}
                    {mintInfo?.version && (
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-[#86868b]">{t('mintDetail.version')}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-[#1d1d1f]">{mintInfo.version}</span>
                          <button
                            onClick={() => handleCopy(mintInfo.version!, 'version')}
                            className="w-7 h-7 flex items-center justify-center"
                          >
                            {copiedField === 'version' ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#86868b]" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Units */}
                    {mintInfo?.units && mintInfo.units.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                        <span className="text-sm text-[#86868b]">{t('mintDetail.units')}</span>
                        <span className="text-sm text-[#1d1d1f]">{mintInfo.units.join(', ')}</span>
                      </div>
                    )}

                    {/* Supported Protocols */}
                    {nuts.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                        <span className="text-sm text-[#86868b]">{t('mintDetail.supportedProtocols')}</span>
                        <button
                          onClick={() => setShowNuts(true)}
                          className="text-sm text-[#3b7df5] font-medium"
                        >
                          {t('mintDetail.viewAll')}
                        </button>
                      </div>
                    )}

                    {/* Pubkey */}
                    {mintInfo?.pubkey && (
                      <div className="px-4 py-3 border-t border-gray-100">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[#86868b]">Pubkey</span>
                          <button
                            onClick={() => handleCopy(mintInfo.pubkey!, 'pubkey')}
                            className="w-7 h-7 flex items-center justify-center"
                          >
                            {copiedField === 'pubkey' ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-[#86868b]" />
                            )}
                          </button>
                        </div>
                        <p className="text-xs font-mono text-[#86868b] break-all mt-1">
                          {mintInfo.pubkey}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Danger Zone */}
                {onDelete && (
                  <div>
                    <p className="font-['Outfit'] font-semibold text-base text-[#1d1d1f] mb-2">
                      {t('mintDetail.dangerZone')}
                    </p>
                    <button
                      onClick={() => setShowDelete(true)}
                      className="w-full border-2 border-red-400 rounded-xl py-4 text-red-500 font-['Outfit'] font-semibold text-sm hover:bg-red-50 transition-colors"
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
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <p className="text-xs font-semibold text-[#86868b] uppercase mb-1">{label}</p>
      {children}
    </div>
  )
}
