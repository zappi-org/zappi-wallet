import { useState, useCallback, useMemo } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import type { Locale } from 'date-fns'
import { ko, ja, es, id as idLocale, enUS } from 'date-fns/locale'
import { BottomSheet } from './BottomSheet'
import { cn } from '@/lib/utils'
import { DAY_MS, formatMD } from '@/utils/dateFilter'
import 'react-day-picker/style.css'

export type { DateFilterValue } from '@/utils/dateFilter'

type Preset = '1w' | '1m' | '3m' | 'all'

export interface DateFilterSheetProps {
  isOpen: boolean
  onClose: () => void
  value: { preset: Preset | null; range: DateRange | undefined }
  onChange: (value: { preset: Preset | null; range: DateRange | undefined }) => void
}

function getPresetRange(preset: Preset): DateRange | undefined {
  if (preset === 'all') return undefined
  const to = new Date()
  const from = new Date(
    preset === '1w' ? Date.now() - 7 * DAY_MS
      : preset === '1m' ? Date.now() - 30 * DAY_MS
      : Date.now() - 90 * DAY_MS,
  )
  return { from, to }
}

const localeMap: Record<string, Locale> = {
  ko,
  ja,
  es,
  id: idLocale,
  en: enUS,
}

// Inner content — mounts fresh each time the sheet opens
function DateFilterContent({ value, onChange, onClose }: {
  value: { preset: Preset | null; range: DateRange | undefined }
  onChange: (value: { preset: Preset | null; range: DateRange | undefined }) => void
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(value.range)
  const [activePreset, setActivePreset] = useState<Preset | null>(value.preset)

  const presets = useMemo<{ key: Preset; label: string }[]>(() => [
    { key: 'all', label: t('history.periodAll') },
    { key: '1w', label: t('history.period1w') },
    { key: '1m', label: t('history.period1m') },
    { key: '3m', label: t('history.period3m') },
  ], [t])

  const handlePreset = useCallback((preset: Preset) => {
    setActivePreset(preset)
    setSelectedRange(getPresetRange(preset))
  }, [])

  const handleRangeSelect = useCallback((range: DateRange | undefined) => {
    setSelectedRange(range)
    setActivePreset(null)
  }, [])

  const handleApply = useCallback(() => {
    onChange({ preset: activePreset, range: selectedRange })
    onClose()
  }, [activePreset, selectedRange, onChange, onClose])

  const calendarLocale = useMemo(() => localeMap[i18n.language] || enUS, [i18n.language])

  const rangeLabel = useMemo(() => {
    if (activePreset) {
      return presets.find((p) => p.key === activePreset)?.label || ''
    }
    if (selectedRange?.from && selectedRange?.to) {
      return `${formatMD(selectedRange.from)} - ${formatMD(selectedRange.to)}`
    }
    return t('history.periodAll')
  }, [activePreset, selectedRange, presets, t])

  return (
    <div className="px-5 pt-3 pb-4 space-y-4">
      {/* Presets */}
      <div className="flex gap-2">
        {presets.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePreset(key)}
            className={cn(
              'flex-1 py-2 rounded-xl text-label font-semibold transition-all',
              activePreset === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-background-card text-foreground-muted hover:bg-background-card/80',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <div className="flex justify-center [&_.rdp-root]:text-foreground [&_.rdp-day]:text-foreground [&_.rdp-selected]:bg-primary/15 [&_.rdp-selected]:text-primary [&_.rdp-range_start]:bg-primary [&_.rdp-range_start]:text-primary-foreground [&_.rdp-range_end]:bg-primary [&_.rdp-range_end]:text-primary-foreground [&_.rdp-today]:font-bold [&_.rdp-today]:text-primary [&_.rdp-outside]:text-foreground-muted/30 [&_.rdp-chevron]:fill-foreground [&_.rdp-month_caption]:text-body [&_.rdp-month_caption]:font-semibold [&_.rdp-weekday]:text-foreground-muted [&_.rdp-weekday]:text-label">
        <DayPicker
          mode="range"
          selected={selectedRange}
          onSelect={handleRangeSelect}
          locale={calendarLocale}
          disabled={{ after: new Date() }}
          numberOfMonths={1}
          showOutsideDays
        />
      </div>

      {/* Selected range display */}
      <p className="text-center text-label text-foreground-muted">{rangeLabel}</p>

      {/* Apply */}
      <button
        onClick={handleApply}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl text-body font-semibold active:scale-[0.98] transition-transform"
      >
        {t('common.confirm')}
      </button>
    </div>
  )
}

export function DateFilterSheet({ isOpen, onClose, value, onChange }: DateFilterSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('history.dateFilter')}>
      <DateFilterContent value={value} onChange={onChange} onClose={onClose} />
    </BottomSheet>
  )
}
