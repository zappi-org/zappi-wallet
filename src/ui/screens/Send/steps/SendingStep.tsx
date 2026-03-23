/**
 * SendingStep — Transmission in progress
 * Figma 256:978: text at top-left, 3D orbital animation centered
 */

import { useTranslation } from 'react-i18next'
import { SendingAnimation } from '@/ui/components/payment'
import type { SendableValidatedData } from '../SendFlow'
import { getDestinationDisplay } from '../sendDisplayHelpers'

interface SendingStepProps {
  validatedData: SendableValidatedData
  amount: number
}

export function SendingStep({ validatedData }: SendingStepProps) {
  const { t } = useTranslation()
  const destination = getDestinationDisplay(validatedData)

  return (
    <div className="flex flex-col h-full bg-background pb-safe">
      {/* Text — centered horizontally, pushed down a bit */}
      <div className="px-6 pt-20 text-center">
        <p className="text-title font-medium leading-relaxed">
          {t('send.sending.message', { destination })}
        </p>
        <p className="text-body text-foreground-muted mt-1">
          {t('send.sending.networkDelay')}
        </p>
      </div>

      {/* Animation centered in remaining space */}
      <div className="flex-1 flex items-center justify-center">
        <SendingAnimation scale={1.35} />
      </div>
    </div>
  )
}
