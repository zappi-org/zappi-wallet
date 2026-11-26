import { useCallback, useMemo, useState, type ClipboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ChevronDown, ChevronRight, ClipboardPaste } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import { useFormatSats, useSatUnit } from '@/utils/format'
import { useAppStore } from '@/store'
import { cn } from '@/ui/lib/utils'
import type { OnchainPayoutOffer } from '@/core/ports/driving/onchain-payout.usecase'
import {
  derivePayoutAmounts,
  formatFeePercent,
  maxPayoutSendAmount,
  parsePayoutAddressInput,
  payoutFormProblem,
  sanitizeAmountText,
  type PayoutAmountSide,
  type PayoutFormValues,
} from './payout-form'

export interface OnchainPayoutAmountStepProps {
  offer: OnchainPayoutOffer
  values: PayoutFormValues
  onChange: (values: PayoutFormValues) => void
  mintUrl: string | null
  mintName: string | null
  mintIconUrl: string | null
  spendable: number
  onOpenMintSelect: () => void
  quoting: boolean
  error: string | null
  onQuote: (params: { sendAmount: number; destination: string }) => void
  onBack: () => void
}

export function OnchainPayoutAmountStep({
  offer,
  values,
  onChange,
  mintUrl,
  mintName,
  mintIconUrl,
  spendable,
  onOpenMintSelect,
  quoting,
  error,
  onQuote,
  onBack,
}: OnchainPayoutAmountStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const unit = useSatUnit()
  const addToast = useAppStore((state) => state.addToast)
  const [feesOpen, setFeesOpen] = useState(false)
  const [showScanner, setShowScanner] = useState(false)

  const { sendAmount, receiveAmount, estimate } = useMemo(
    () => derivePayoutAmounts(offer, values),
    [offer, values],
  )
  const hasAmount = values.amountText.length > 0
  const sendText = values.amountSide === 'send' ? values.amountText : hasAmount && estimate ? String(sendAmount) : ''
  const receiveText =
    values.amountSide === 'receive' ? values.amountText : hasAmount && estimate ? String(receiveAmount) : ''
  const totalFees = estimate ? estimate.serviceFee + estimate.networkFee + estimate.payoutFee : null
  const destination = values.address.trim()

  const problem = payoutFormProblem({ offer, sendAmount, address: destination, spendable })
  const ready = problem === null && sendAmount > 0 && destination.length > 0 && mintUrl !== null

  const updateAmount = useCallback(
    (side: PayoutAmountSide, raw: string) => {
      onChange({ ...values, amountSide: side, amountText: sanitizeAmountText(raw) })
    },
    [onChange, values],
  )

  const handleMax = useCallback(() => {
    const max = maxPayoutSendAmount(offer, spendable)
    if (max <= 0) return
    onChange({ ...values, amountSide: 'send', amountText: String(max) })
  }, [offer, spendable, onChange, values])

  const applyAddressInput = useCallback(
    (raw: string) => {
      const parsed = parsePayoutAddressInput(raw)
      if (!parsed) {
        onChange({ ...values, address: raw.trim() })
        return
      }
      onChange({
        ...values,
        address: parsed.address,
        ...(parsed.amountSats !== undefined
          ? { amountSide: 'send' as const, amountText: String(parsed.amountSats) }
          : {}),
      })
    },
    [onChange, values],
  )

  const handleAddressPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData('text')
      if (!text) return
      event.preventDefault()
      applyAddressInput(text)
    },
    [applyAddressInput],
  )

  const handlePasteButton = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) applyAddressInput(text)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError') })
    }
  }, [applyAddressInput, addToast, t])

  const handleScan = useCallback(
    (result: string) => {
      setShowScanner(false)
      applyAddressInput(result)
    },
    [applyAddressInput],
  )

  const buttonLabel = useMemo(() => {
    switch (problem?.kind) {
      case 'min':
        return t('onchainPayout.form.minimum', { amount: formatSats(problem.amount) })
      case 'max':
        return t('onchainPayout.form.maximum', { amount: formatSats(problem.amount) })
      case 'address':
        return t('onchainPayout.form.invalidAddress')
      case 'balance':
        return t('onchainPayout.form.insufficientBalance')
      default:
        return t('onchainPayout.form.getQuote')
    }
  }, [problem, t, formatSats])

  return (
    <>
      <ScreenHeader title={t('onchainPayout.title')} onBack={onBack} />
      <div className="flex-1 flex flex-col px-5 overflow-y-auto pb-4">
        <button
          type="button"
          onClick={onOpenMintSelect}
          data-testid="onchain-payout-mint"
          className="mt-2 flex items-center gap-2 self-start rounded-xl bg-foreground/[0.04] px-3 py-2"
        >
          {mintIconUrl && <img src={mintIconUrl} alt="" className="w-5 h-5 rounded-full" />}
          <span className="text-label font-medium text-foreground">
            {mintName ?? t('onchainPayout.selectMint')}
          </span>
          <span className="text-label text-foreground-muted">{formatSats(spendable)}</span>
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        </button>

        <div className="mt-4 rounded-card border border-border/60 bg-background-card">
          <AmountBox
            label={t('onchainPayout.form.send')}
            value={sendText}
            unit={unit}
            testId="onchain-payout-send-amount"
            onChange={(raw) => updateAmount('send', raw)}
            action={
              <button
                type="button"
                onClick={handleMax}
                className="px-2.5 py-1 rounded-lg bg-foreground/[0.06] text-caption font-semibold text-foreground active:bg-foreground/[0.09]"
              >
                {t('onchainPayout.form.max')}
              </button>
            }
          />
          <div className="relative h-px bg-border/60">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border border-border/60 bg-background flex items-center justify-center">
              <ArrowDown className="w-4 h-4 text-foreground-muted" />
            </span>
          </div>
          <AmountBox
            label={t('onchainPayout.form.receive')}
            value={receiveText}
            unit={unit}
            testId="onchain-payout-receive-amount"
            onChange={(raw) => updateAmount('receive', raw)}
          />
        </div>

        <div className="mt-3 rounded-card bg-foreground/[0.03] px-3">
          <button
            type="button"
            aria-expanded={feesOpen}
            onClick={() => setFeesOpen((open) => !open)}
            className="w-full flex items-center justify-between py-2.5"
            data-testid="onchain-payout-fees-toggle"
          >
            <span className="text-label text-foreground-muted">
              {t('onchainPayout.form.fees', {
                amount: totalFees === null ? '–' : formatSats(totalFees),
              })}
            </span>
            <ChevronDown
              className={cn('w-4 h-4 text-foreground-muted transition-transform', feesOpen && 'rotate-180')}
            />
          </button>
          {feesOpen && (
            <div className="flex flex-col gap-1.5 pb-3" data-testid="onchain-payout-fee-details">
              <FeeLine label={t('onchainPayout.networkFee')} value={formatSats(offer.networkFee)} />
              <FeeLine
                label={t('onchainPayout.form.serviceFeeWithRate', { rate: formatFeePercent(offer.feePercent) })}
                value={estimate ? formatSats(estimate.serviceFee) : '–'}
              />
              <FeeLine
                label={t('onchainPayout.payoutFee')}
                value={estimate ? formatSats(estimate.payoutFee) : '–'}
              />
            </div>
          )}
        </div>

        <div className="mt-4 relative flex items-center gap-1 rounded-2xl border border-border bg-background-card px-4 focus-within:border-brand transition-colors">
          <input
            type="text"
            value={values.address}
            onChange={(event) => onChange({ ...values, address: event.target.value })}
            onPaste={handleAddressPaste}
            placeholder={t('onchainPayout.form.addressPlaceholder')}
            aria-label={t('onchainPayout.destination')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="onchain-payout-address"
            className="flex-1 min-w-0 bg-transparent text-body font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none truncate py-3.5"
          />
          <button
            type="button"
            onClick={() => void handlePasteButton()}
            aria-label={t('common.paste')}
            className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] shrink-0"
          >
            <ClipboardPaste className="w-5 h-5 text-foreground-muted" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            aria-label={t('scanner.title')}
            className="w-10 h-10 -mr-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] shrink-0"
          >
            <CameraFilled className="text-foreground-muted" />
          </button>
        </div>

        {error && (
          <span className="text-label text-accent-danger text-center mt-3" data-testid="onchain-payout-error">
            {error}
          </span>
        )}
      </div>
      <div className="px-5 pb-app pt-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={quoting}
          disabled={!ready || quoting}
          data-testid="onchain-payout-get-quote"
          onClick={() => onQuote({ sendAmount, destination })}
        >
          {buttonLabel}
        </Button>
      </div>
      <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
    </>
  )
}

function AmountBox({
  label,
  value,
  unit,
  testId,
  onChange,
  action,
}: {
  label: string
  value: string
  unit: string
  testId: string
  onChange: (raw: string) => void
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="flex items-center justify-between">
        <span className="text-caption font-medium text-foreground-muted">{label}</span>
        {action}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          placeholder="0"
          aria-label={label}
          data-testid={testId}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 min-w-0 bg-transparent text-title font-semibold text-foreground placeholder:text-foreground-muted focus:outline-none"
        />
        <span className="text-body text-foreground-muted shrink-0">{unit}</span>
      </span>
    </div>
  )
}

function FeeLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-caption text-foreground-muted">{label}</span>
      <span className="text-caption font-medium text-foreground">{value}</span>
    </div>
  )
}
