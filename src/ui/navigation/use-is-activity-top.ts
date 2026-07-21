import { useActivity } from '@stackflow/react'

/**
 * True when the owning stackflow activity is the top of the stack — or when
 * rendered outside any activity (standalone tests, non-stackflow mounts).
 *
 * A covered activity only gets its own DOM hidden (visibility:hidden in the
 * stack renderer); anything it portals to document.body (e.g. a Vaul drawer)
 * stays painted and modal over whatever activity is pushed on top. Consumers
 * read this to dismiss such portals once their activity is no longer top.
 */
export function useIsActivityTop(): boolean {
  // useActivity() reads a context that defaults to null outside <Stack>, so a
  // standalone render reports "top" and never forces a dismissal.
  const activity = useActivity() as { isTop: boolean } | null
  return activity?.isTop ?? true
}
