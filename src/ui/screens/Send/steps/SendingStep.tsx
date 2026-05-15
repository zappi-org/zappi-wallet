/**
 * SendingStep — Transmission in progress
 */

import { useTranslation, Trans } from 'react-i18next'
import { useFormatSats } from '@/utils/format'
import { SendingAnimation } from '@/ui/components/payment'
import type { SendableValidatedData } from '../SendFlow'
import { getDestinationDisplay } from '../sendDisplayHelpers'

interface SendingStepProps {
  validatedData: SendableValidatedData
  amount: number
  displayName?: string
}

export function SendingStep({ validatedData, amount, displayName }: SendingStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const destination = getDestinationDisplay(validatedData, displayName)

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Sending animation */}
        <div className="mb-6">
          <SendingAnimation scale={0.5} />
        </div>

        {/* Sentence — single Trans for natural word order per language */}
        <div className="text-center min-w-0 max-w-full">
          <p className="text-heading font-semibold text-foreground whitespace-pre-line">
            <Trans
              i18nKey="send.sending.fullMessage"
              values={{ recipient: destination, amount: formatSats(amount) }}
              components={{
                b: <span className="inline-block min-w-0 max-w-full truncate align-bottom text-brand" />,
                to: <span className="inline-flex max-w-full min-w-0 items-baseline whitespace-nowrap align-bottom" />,
              }}
            />
          </p>
        </div>

        <p className="text-body text-foreground-muted mt-4">
          {t('send.sending.networkDelay')}
        </p>
      </div>
    </div>
  )
}
