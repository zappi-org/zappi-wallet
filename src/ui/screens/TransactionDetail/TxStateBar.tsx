import type { TFunction } from 'i18next'
import { cn } from '@/ui/lib/utils'
import type { TxStateTrack } from './tx-state-machine'

function nodeDotClass(tone: string): string {
  switch (tone) {
    case 'done':
      return 'bg-foreground'
    case 'current':
      return 'bg-status-pending ring-4 ring-status-pending/25'
    case 'fail':
      return 'bg-accent-danger'
    default:
      return 'bg-background border-2 border-border'
  }
}

function nodeLabelClass(tone: string): string {
  switch (tone) {
    case 'done':
      return 'text-foreground font-bold'
    case 'current':
      return 'text-status-pending font-bold'
    case 'fail':
      return 'text-accent-danger font-bold'
    default:
      return 'text-foreground-subtle font-semibold'
  }
}

export function TxStateBar({ track, t, locale, framed = true }: { track: TxStateTrack; t: TFunction; locale: string; framed?: boolean }) {
  const n = track.nodes.length
  const lastReachedIdx = track.nodes.reduce(
    (max, node, i) => (node.tone === 'done' || node.tone === 'current' || node.tone === 'fail' ? i : max),
    0,
  )
  const align = (i: number) => (i === 0 ? 'text-left' : i === n - 1 ? 'text-right' : 'text-center')
  const time = (at?: number) =>
    at !== undefined
      ? new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : '—'

  return (
    <div className={framed ? 'rounded-[20px] bg-background-card border border-border/60 px-5 pt-4 pb-4' : 'px-0.5'}>
      <div className="flex justify-between">
        {track.nodes.map((node, i) => (
          <span key={node.labelKey} className={cn('w-full text-caption', align(i), nodeLabelClass(node.tone))}>
            {t(node.labelKey)}
            {node.tone === 'void' && ' ✕'}
          </span>
        ))}
      </div>
      <div className="relative mx-1 mt-6 mb-2 h-[3px] rounded-full bg-border/70">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: `${(lastReachedIdx / (n - 1)) * 100}%` }}
        />
        {track.nodes.map((node, i) => (
          <span
            key={node.labelKey}
            className={cn('absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full', nodeDotClass(node.tone))}
            style={{ left: `${(i / (n - 1)) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        {track.nodes.map((node, i) => (
          <span key={node.labelKey} className={cn('w-full text-overline text-foreground-muted tabular-nums', align(i))}>
            {node.tone === 'void' ? '—' : time(node.at)}
          </span>
        ))}
      </div>
      {track.noteKey && (
        <p className="mt-3.5 rounded-xl bg-background px-3 py-2 text-center text-caption text-foreground-muted">
          {t(track.noteKey)}
        </p>
      )}
    </div>
  )
}
