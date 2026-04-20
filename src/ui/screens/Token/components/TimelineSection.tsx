import { useTranslation } from 'react-i18next'
import { TimelineRow } from './TimelineRow'
import type { MockTimelineEntry, MockTimelineGroup } from '../types'

export interface TimelineSectionProps {
  groups: MockTimelineGroup[]
  onSelect?: (entry: MockTimelineEntry) => void
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
          {group.entries.map((entry) => (
            <TimelineRow
              key={entry.id}
              entry={entry}
              onSelect={onSelect ? () => onSelect(entry) : undefined}
            />
          ))}
        </div>
      ))}
    </section>
  )
}
