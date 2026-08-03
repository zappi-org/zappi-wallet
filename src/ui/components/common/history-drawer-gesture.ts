const COMMIT_DISTANCE_PX = 100
const FLICK_VELOCITY_PX_PER_SECOND = 500

export function shouldHistoryDrawerStayOpen({
  expanded,
  travelled,
  velocityY,
}: {
  expanded: boolean
  travelled: number
  velocityY: number
}): boolean {
  if (Math.abs(velocityY) > FLICK_VELOCITY_PX_PER_SECOND) return velocityY < 0
  const committed = travelled > COMMIT_DISTANCE_PX
  return expanded ? !committed : committed
}
