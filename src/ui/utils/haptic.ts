/**
 * Haptic Feedback Utility for PWA
 * Uses navigator.vibrate() API when available
 *
 * Note: iOS Safari does not support vibration API (security policy)
 * Android Chrome and some mobile browsers support it
 */

/**
 * Trigger haptic feedback with the given pattern
 * @param pattern - Duration in ms or array of [vibrate, pause, vibrate, ...]
 */
export function vibrate(pattern: number | number[] = 50): boolean {
  if ('vibrate' in navigator) {
    try {
      return navigator.vibrate(pattern)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Check if haptic feedback is supported
 */
export function isHapticSupported(): boolean {
  return 'vibrate' in navigator
}

// ============= Preset Patterns =============

/**
 * Light tap - for type detection success
 */
export function hapticTap(): boolean {
  return vibrate(50)
}

/**
 * Double tap - for validation error
 */
export function hapticError(): boolean {
  return vibrate([50, 30, 50])
}

/**
 * Success - for payment/receive completion
 */
export function hapticSuccess(): boolean {
  return vibrate(100)
}

/**
 * Heavy - for important confirmations
 */
export function hapticHeavy(): boolean {
  return vibrate(150)
}

/**
 * Selection - for button press
 */
export function hapticSelection(): boolean {
  return vibrate(30)
}
