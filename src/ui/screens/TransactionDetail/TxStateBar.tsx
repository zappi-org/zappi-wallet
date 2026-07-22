import type { TFunction } from 'i18next'
import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/ui/lib/utils'
import type { TxStateTrack } from './tx-state-machine'

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

// Parcel-tracker node: reached states carry a glyph, the current one glows.
function StateDot({ tone }: { tone: string }) {
  if (tone === 'done') {
    return (
      <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-foreground">
        <Check className="h-[9px] w-[9px] text-background" strokeWidth={3.5} />
      </span>
    )
  }
  if (tone === 'fail') {
    return (
      <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-accent-danger">
        <X className="h-[9px] w-[9px] text-white" strokeWidth={3.5} />
      </span>
    )
  }
  if (tone === 'current') {
    return (
      <span className="relative flex h-[13px] w-[13px] items-center justify-center">
        <span className="absolute h-[24px] w-[24px] rounded-full bg-status-pending/25 animate-pulse motion-reduce:animate-none" />
        <span className="relative h-[13px] w-[13px] rounded-full bg-status-pending ring-4 ring-status-pending/20" />
      </span>
    )
  }
  // todo / void — the road not yet traveled
  return <span className="block h-[11px] w-[11px] rounded-full bg-background border-2 border-border" />
}

export function TxStateBar({ track, t, locale, framed = true }: { track: TxStateTrack; t: TFunction; locale: string; framed?: boolean }) {
  const n = track.nodes.length
  const lastReachedIdx = track.nodes.reduce(
    (max, node, i) => (node.tone === 'done' || node.tone === 'current' || node.tone === 'fail' ? i : max),
    0,
  )
  const targetPct = (lastReachedIdx / (n - 1)) * 100

  // Draw-in: the fill sweeps from the first node to the reached one on mount.
  const [fillPct, setFillPct] = useState(0)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFillPct(targetPct))
    return () => cancelAnimationFrame(raf)
  }, [targetPct])

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
      <div className="relative mx-1 mt-6 mb-2 h-[3px]">
        {/* Dashed base — the untraveled stretch of the journey */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-border) 0 5px, transparent 5px 10px)' }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${fillPct}%` }}
        />
        {track.nodes.map((node, i) => (
          <span
            key={node.labelKey}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(i / (n - 1)) * 100}%` }}
          >
            <StateDot tone={node.tone} />
          </span>
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
