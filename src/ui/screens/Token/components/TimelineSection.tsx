import { useTranslation } from 'react-i18next'
import { getLocaleCode } from '@/utils/format'
import type { Transaction } from '@/core/domain/transaction'
import type { TimelineGroup, TimelineKind } from '@/ui/hooks/use-transaction-history'
import { cn } from '@/ui/lib/utils'
import { TimelineRow } from './TimelineRow'

export interface TimelineSectionProps {
  groups: TimelineGroup[]
  onSelect?: (tx: Transaction) => void
  /** Collapse the in-flow "내역" h3 when the parent's sticky header has merged it inline. */
  hideTitle?: boolean
  /** Tailwind top-* class for the date anchor sticky offset (matches parent's sticky header height). */
  anchorTopClass?: string
}

interface AnchorText {
  major: string
  minor?: string
}

function zeroPad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
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
): AnchorText {
  switch (group.kind) {
    case 'today':
    case 'yesterday': {
      const d = new Date(group.refDate)
      const weekday = shortWeekday(d, locale)
      const major = `${group.month}.${group.day}`
      const minorKey =
        group.kind === 'today'
          ? 'token.history.anchor.today'
          : 'token.history.anchor.yesterday'
      return { major, minor: t(minorKey, { weekday }) }
    }
    case 'dayThisMonth': {
      const d = new Date(group.refDate)
      const weekday = shortWeekday(d, locale)
      const major = `${group.month}.${group.day}`
      return { major, minor: weekday }
    }
    case 'monthThisYear': {
      const lang = locale.toLowerCase().slice(0, 2)
      if (lang === 'ko' || lang === 'ja' || lang === 'zh') {
        return {
          major: String(group.month),
          minor: t('token.history.anchor.monthSameYear'),
        }
      }
      let monthName = String(group.month)
      try {
        monthName = new Intl.DateTimeFormat(locale, { month: 'short' }).format(
          new Date(group.year, group.month - 1, 1),
        )
      } catch { /* ignore */ }
      return { major: monthName }
    }
    case 'monthPastYear':
      return {
        major: t('token.history.anchor.monthOtherYear', {
          year: group.year,
          month02: zeroPad2(group.month),
        }),
      }
  }
}

function headerSizeClass(kind: TimelineKind): string {
  // `2024.12` (7자) 는 좌측 컬럼 폭 제약으로 작년이전만 작은 폰트.
  return kind === 'monthPastYear'
    ? 'text-body font-display font-bold text-foreground leading-none'
    : 'text-heading font-display font-bold text-foreground leading-none'
}

export function TimelineSection({
  groups,
  onSelect,
  hideTitle = false,
  anchorTopClass = 'top-14',
}: TimelineSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = getLocaleCode(i18n.language)

  if (groups.length === 0) return null

  return (
    <section className="flex flex-col gap-6">
      <div
        className={cn(
          'overflow-hidden transition-[height,opacity] duration-200',
          hideTitle ? 'h-0 opacity-0' : 'h-12 opacity-100',
        )}
      >
        <h3 className="h-12 flex items-center text-title-sm font-bold text-foreground">
          {t('token.history.section')}
        </h3>
      </div>
      {groups.map((group) => {
        const anchor = buildAnchor(t, group, locale)
        return (
          <div key={group.key} className="flex items-start gap-3">
            <div className={cn('w-14 shrink-0 pt-1 sticky self-start', anchorTopClass)}>
              <div className={headerSizeClass(group.kind)}>
                {anchor.major}
              </div>
              {anchor.minor && (
                <div className="mt-1.5 text-overline text-foreground-muted">
                  {anchor.minor}
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2 min-w-0">
              {group.entries.map((tx) => (
                <TimelineRow
                  key={tx.id}
                  tx={tx}
                  groupKind={group.kind}
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
