import { useTranslation } from 'react-i18next'
import type { Transaction } from '@/core/domain/transaction'
import type { TimelineGroup } from '@/ui/hooks/use-transaction-history'
import { TimelineRow } from './TimelineRow'

export interface TimelineSectionProps {
  groups: TimelineGroup[]
  onSelect?: (tx: Transaction) => void
}

export function TimelineSection({ groups, onSelect }: TimelineSectionProps) {
  const { t } = useTranslation()

  if (groups.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-subtitle font-semibold text-foreground">
        {t('token.history.section')}
      </h3>
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <span className="text-caption text-foreground-muted">
            {t(`token.history.group.${group.label}`)}
          </span>
          {group.entries.map((tx) => (
            <TimelineRow
              key={tx.id}
              tx={tx}
              onSelect={onSelect ? () => onSelect(tx) : undefined}
            />
          ))}
        </div>
      ))}
    </section>
  )
}
