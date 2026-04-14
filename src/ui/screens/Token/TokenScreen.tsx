import { type RefObject } from 'react'

export interface TokenScreenProps {
  scrollRef: RefObject<HTMLDivElement | null>
}

export function TokenScreen({ scrollRef }: TokenScreenProps) {
  return (
    <div ref={scrollRef} className="flex-1 h-full overflow-y-auto pb-28">
      <div className="p-4 space-y-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-muted/30" />
        ))}
      </div>
    </div>
  )
}

export default TokenScreen
