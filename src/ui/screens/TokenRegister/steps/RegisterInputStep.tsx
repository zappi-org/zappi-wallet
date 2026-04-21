import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { useInputParser } from '@/ui/hooks/use-input-parser'
import { useAppStore } from '@/store'
import { hapticError } from '@/ui/utils/haptic'
import { translateError } from '@/ui/utils/error-i18n'
import { useTranslation } from 'react-i18next'
import { Camera, Clipboard } from 'lucide-react'
import { useCallback, useState } from 'react'
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
  const addToast = useAppStore((s) => s.addToast)

  const [token, setToken] = useState(initialToken)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [validating, setValidating] = useState(false)

  const pasteFromClipboard = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) setToken(text.trim())
      }
    } catch {
      /* permission denied — silent */
    }
  }, [])

  const handleScan = useCallback((value: string) => {
    setToken(value.trim())
    setScannerOpen(false)
  }, [])

  const handleNext = useCallback(async () => {
    const raw = token.trim()
    if (!raw || validating) return
    setValidating(true)
    try {
      const classified = inputParser.detectAndClassify(raw)
      const validated = await inputParser.validateAsync(classified)
      if (validated.type !== 'cashu-token') {
        hapticError()
        addToast({
          type: 'error',
          message: t('scanner.invalidToken'),
        })
        return
      }
      onNext(validated)
    } catch (error) {
      hapticError()
      addToast({ type: 'error', message: translateError(error, t) })
    } finally {
      setValidating(false)
    }
  }, [token, validating, inputParser, onNext, addToast, t])

  const canProceed = token.trim().length > 0 && !validating

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
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="토큰 입력"
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
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
