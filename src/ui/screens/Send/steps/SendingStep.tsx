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
}

export function SendingStep({ validatedData, amount }: SendingStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const destination = getDestinationDisplay(validatedData)

  return (
    <div className="flex flex-col h-full bg-background pb-safe">
      {/* Centered content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        {/* Sending animation */}
        <div className="mb-6">
          <SendingAnimation scale={0.5} />
        </div>

        {/* Sentence — single Trans for natural word order per language */}
        <div className="text-center">
          <p className="text-heading font-semibold text-foreground whitespace-pre-line">
            <Trans
              i18nKey="send.sending.fullMessage"
              values={{ recipient: destination, amount: formatSats(amount) }}
              components={{ b: <span className="text-brand" /> }}
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
