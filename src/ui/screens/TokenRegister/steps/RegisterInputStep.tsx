import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { hapticError } from '@/ui/utils/haptic'
import { useTranslation } from 'react-i18next'
import { Camera, Clipboard } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ValidatedCashuToken } from '@/core/domain/input-types'

export interface RegisterInputStepProps {
  onBack: () => void
  /** Passes a validated cashu token up so the flow can route by trust status. */
  onNext: (token: ValidatedCashuToken) => void
  initialToken: string
}

export function RegisterInputStep({
  onBack,
  onNext,
  initialToken,
}: RegisterInputStepProps) {
  const { t } = useTranslation()
  const inputParser = useInputParser()

  const [token, setToken] = useState(initialToken)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [validating, setValidating] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const advanceGuardRef = useRef(false)
  /** Value at mount — used to suppress auto-advance when state is restored on back-nav. */
  const initialTokenRef = useRef(initialToken.trim())

  const handleTokenChange = useCallback((value: string) => {
    setToken(value)
    setInlineError(null)
  }, [])

  const pasteFromClipboard = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) {
          setToken(text.trim())
          setInlineError(null)
        }
      }
    } catch {
      /* permission denied — silent */
    }
  }, [])

  const handleScan = useCallback((value: string) => {
    setToken(value.trim())
    setInlineError(null)
    setScannerOpen(false)
  }, [])

  const handleNext = useCallback(async () => {
    const raw = token.trim()
    if (!raw || validating) return
    setValidating(true)
    setInlineError(null)
    try {
      const classified = inputParser.detectAndClassify(raw)
      const validated = await inputParser.validateAsync(classified)
      if (validated.type !== 'cashu-token') {
        hapticError()
        setInlineError(t('scanner.invalidToken'))
        return
      }
      advanceGuardRef.current = true
      onNext(validated)
    } catch {
      hapticError()
      setInlineError(t('scanner.invalidToken'))
    } finally {
      setValidating(false)
    }
  }, [token, validating, inputParser, onNext, t])

  // Auto-advance: validate in the background when the input looks like a complete
  // cashu token and the value has changed from the restored mount state. This
  // prevents re-triggering when the user backs out of the confirm step.
  useEffect(() => {
    const raw = token.trim()
    if (!raw || validating || advanceGuardRef.current) return
    if (raw === initialTokenRef.current) return
    if (!/^cashu[ab]/i.test(raw)) return
    if (raw.length < 40) return

    let cancelled = false
    const handle = window.setTimeout(async () => {
      try {
        const classified = inputParser.detectAndClassify(raw)
        const validated = await inputParser.validateAsync(classified)
        if (cancelled) return
        if (validated.type === 'cashu-token') {
          advanceGuardRef.current = true
          onNext(validated)
        }
      } catch {
        /* silent — user may still be editing */
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [token, validating, inputParser, onNext])

  const canProceed = token.trim().length > 0 && !validating
  const showError = inlineError !== null

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="토큰 등록하기" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <h2 className="text-heading font-semibold text-foreground leading-snug">
          토큰을 붙여넣거나 스캔해서
          <br />
          등록할 수 있어요.
        </h2>
        <p className="text-body text-foreground-muted mt-3">
          토큰은 <span className="font-semibold text-foreground">cashuB</span> 로 시작하는 문자열이에요.
        </p>

        {/* Token input — underline style */}
        <div className="mt-8">
          <div
            className={`flex items-center border-b transition-colors ${
              showError
                ? 'border-accent-danger'
                : 'border-border focus-within:border-foreground/20'
            }`}
          >
            <input
              type="text"
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="토큰 입력"
              className={`flex-1 min-w-0 bg-transparent py-2 text-body font-medium placeholder:text-foreground-muted focus:outline-none ${
                showError ? 'text-accent-danger' : 'text-foreground'
              }`}
            />
          </div>
          {showError && (
            <p className="mt-1.5 text-caption text-accent-danger">
              잘못된 형식이에요. cashuB 로 시작하는 토큰인지 확인해주세요.
            </p>
          )}
        </div>

        {/* Paste / Scan chips */}
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={pasteFromClipboard}
            className="flex items-center gap-1.5 px-4 h-10 rounded-full bg-background-card text-foreground hover:bg-background-hover transition-colors"
          >
            <Clipboard className="w-4 h-4" strokeWidth={1.8} />
            <span className="text-body">붙여넣기</span>
          </button>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-1.5 px-4 h-10 rounded-full bg-background-card text-foreground hover:bg-background-hover transition-colors"
          >
            <Camera className="w-4 h-4" strokeWidth={1.8} />
            <span className="text-body">스캔하기</span>
          </button>
        </div>
      </div>

      <BottomActionBar extraBottom={16} gap="none" className="px-6">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          disabled={!canProceed}
          className="w-full"
        >
          {validating ? '확인 중…' : '다음'}
        </Button>
      </BottomActionBar>

      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScan}
      />
    </div>
  )
}
