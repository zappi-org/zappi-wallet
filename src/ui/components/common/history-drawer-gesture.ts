const COMMIT_DISTANCE_PX = 100
const FLICK_VELOCITY_PX_PER_SECOND = 500
/** Above the home-indicator band itself, iOS still claims a little extra. */
const SYSTEM_GESTURE_MARGIN_PX = 10

/**
 * iOS delivers the first touches of a home-indicator swipe to the page before
 * taking the gesture over, so a drag that begins in that band would visibly
 * yank the sheet while the user is leaving the app. Those swipes belong to
 * the system — never start a sheet drag from there.
 */
export function isInSystemGestureZone(
  clientY: number,
  viewportHeight: number,
  safeAreaBottom: number,
): boolean {
  return clientY >= viewportHeight - (safeAreaBottom + SYSTEM_GESTURE_MARGIN_PX)
}

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
