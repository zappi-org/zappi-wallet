/**
 * SendingStep — Transmission in progress
 * Figma 256:978: text at top-left, 3D orbital animation centered
 */

import { useTranslation } from 'react-i18next'
import { SendingAnimation } from '@/ui/components/payment'
import type { SendableValidatedData } from '../SendFlow'

interface SendingStepProps {
  validatedData: SendableValidatedData
  amount: number
}

function getDestinationDisplay(data: SendableValidatedData): string {
  switch (data.type) {
    case 'bolt11':
      return data.description || 'Lightning'
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request':
      return 'eCash'
  }
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
