import { useTranslation } from 'react-i18next'
import { getLocaleCode } from '@/utils/format'
import type { Transaction } from '@/core/domain/transaction'
import type { TimelineGroup } from '@/ui/hooks/use-transaction-history'
import { TimelineRow } from './TimelineRow'

export interface TimelineSectionProps {
  groups: TimelineGroup[]
  onSelect?: (tx: Transaction) => void
}

interface AnchorText {
  major: string
  minor: string
}

function shortWeekday(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  } catch {
    return ''
  }
}

function buildAnchor(
  t: (key: string, opts?: Record<string, unknown>) => string,
  group: TimelineGroup,
  locale: string,
  currentYear: number,
): AnchorText {
  if (group.kind === 'day') {
    const d = new Date(group.refDate)
    const weekday = shortWeekday(d, locale)
    const daysSince = group.daysSince ?? 0
    const major = `${group.month}.${group.day}`
    if (daysSince === 0) {
      return { major, minor: t('token.history.anchor.today', { weekday }) }
    }
    if (daysSince === 1) {
      return { major, minor: t('token.history.anchor.yesterday', { weekday }) }
    }
    return {
      major,
      minor: t('token.history.anchor.daysAgo', { weekday, count: daysSince }),
    }
  }
  if (group.kind === 'partOfMonth') {
    const partKey = group.part ?? 'early'
    return {
      major: `${group.month}`,
      minor: t(`token.history.anchor.${partKey}`),
    }
  }
  // month
  const sameYear = group.year === currentYear
  return {
    major: `${group.month}`,
    minor: sameYear
      ? t('token.history.anchor.monthSameYear', { month: group.month })
      : t('token.history.anchor.monthOtherYear', {
          year: group.year,
          month: group.month,
        }),
  }
}

export function TimelineSection({ groups, onSelect }: TimelineSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = getLocaleCode(i18n.language)
  const currentYear = new Date().getFullYear()

  if (groups.length === 0) return null

  return (
    <section className="flex flex-col gap-6">
      <h3 className="text-title-sm font-bold text-foreground">
        {t('token.history.section')}
      </h3>
      {groups.map((group) => {
        const anchor = buildAnchor(t, group, locale, currentYear)
        return (
          <div key={group.key} className="flex items-start gap-3">
            <div className="w-14 shrink-0 pt-1">
              <div className="text-heading font-display font-bold text-foreground leading-none">
                {anchor.major}
              </div>
              <div className="mt-1.5 text-overline text-foreground-muted">
                {anchor.minor}
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {group.entries.map((tx) => (
                <TimelineRow
                  key={tx.id}
                  tx={tx}
                  onSelect={onSelect ? () => onSelect(tx) : undefined}
                />
              ))}
            </div>
          </div>
        )
      })}
      <p className="text-caption text-foreground-muted text-center pt-2">
        {t('token.history.endOfList')}
      </p>
    </section>
  )
}
