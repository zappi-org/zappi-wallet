/**
 * RedeemSheet — direct receive entry: embedded camera, photo import, paste.
 * Validation mirrors RegisterInputStep: cashu tokens bubble up for trust
 * routing; anything else goes to the universal router.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QrScannerLib from 'qr-scanner'
import { Image as ImageIcon, ClipboardPaste } from 'lucide-react'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { Button } from '@/ui/components/common/Button'
import { QrScanner } from '@/ui/components/common/QrScanner'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { hapticError, hapticTap } from '@/ui/utils/haptic'
import type { ValidatedCashuToken, ValidatedData } from '@/core/domain/input-types'

export interface RedeemSheetProps {
  isOpen: boolean
  onClose: () => void
  /** Validated cashu token → flow routes by trust status. */
  onValidated: (token: ValidatedCashuToken) => void
  /** Non-cashu input (bolt11 etc.) → universal router. */
  onRouteValidated?: (data: ValidatedData) => void
  /** Deep-link token (scanner/router entry) — auto-validated on open. */
  initialToken?: string
}

export function RedeemSheet({ isOpen, onClose, onValidated, onRouteValidated, initialToken }: RedeemSheetProps) {
  const { t } = useTranslation()
  const inputParser = useInputParser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const busyRef = useRef(false)

  const handleRaw = useCallback(async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed || busyRef.current) return
    busyRef.current = true
    setValidating(true)
    setError(null)
    try {
      const classified = inputParser.detectAndClassify(trimmed)
      const validated = await inputParser.validateAsync(classified)
      if (validated.type !== 'cashu-token') {
        if (onRouteValidated) { onRouteValidated(validated); return }
        hapticError()
        setError(t('scanner.invalidToken'))
        return
      }
      onValidated(validated as ValidatedCashuToken)
    } catch {
      hapticError()
      setError(t('scanner.invalidToken'))
    } finally {
      busyRef.current = false
      setValidating(false)
    }
  }, [inputParser, onValidated, onRouteValidated, t])

  // Deep-link entry (scanner/router) — validate the pre-supplied token once.
  // Track the consumed token VALUE, not a boolean: back-from-confirm reopens the
  // sheet with the same initialToken, and resetting on close would re-validate it
  // forever. A genuinely new deep-link token (different string) still validates.
  const consumedTokenRef = useRef<string | null>(null)
  useEffect(() => {
    if (isOpen && initialToken && initialToken !== consumedTokenRef.current) {
      consumedTokenRef.current = initialToken
      void handleRaw(initialToken)
    }
    if (!isOpen) {
      setError(null)
    }
  }, [isOpen, initialToken, handleRaw])

  const handlePaste = useCallback(async () => {
    hapticTap()
    try {
      const text = await navigator.clipboard?.readText?.()
      if (text) await handleRaw(text)
    } catch { /* permission denied — the camera/photo paths remain */ }
  }, [handleRaw])

  const handleImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const result = await QrScannerLib.scanImage(file, { returnDetailedScanResult: true })
      await handleRaw(result.data)
    } catch {
      hapticError()
      setError(t('scanner.noQrFound'))
    }
  }, [handleRaw, t])

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('receive.redeem.title')}>
      <div className="flex flex-col px-6 pb-safe">
        <div className="mt-2 overflow-hidden rounded-2xl bg-black aspect-square">
          {isOpen && <QrScanner onScan={(r) => void handleRaw(r)} active={isOpen} />}
        </div>

        <div className="h-6 mt-2 text-center">
          {error && <p className="text-caption text-accent-danger">{error}</p>}
        </div>

        <div className="flex gap-3">
          <Button variant="secondary" size="xl" disabled={validating} onClick={() => { hapticTap(); fileInputRef.current?.click() }} className="flex-none px-5">
            <ImageIcon className="w-4 h-4 mr-1.5" />
            {t('receive.redeem.photo')}
          </Button>
          <Button variant="brand" size="xl" loading={validating} onClick={handlePaste} className="flex-1">
            <ClipboardPaste className="w-4 h-4 mr-1.5" />
            {t('receive.redeem.paste')}
          </Button>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleImage(e)} />
      </div>
    </BottomSheet>
  )
}
