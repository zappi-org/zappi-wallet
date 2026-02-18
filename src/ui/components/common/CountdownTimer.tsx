import { useState, useEffect } from 'react'

interface CountdownTimerProps {
  /** Expiry timestamp in milliseconds */
  expiryMs: number
  /** Called when countdown reaches 0 */
  onExpired?: () => void
  /** Render function - receives remaining seconds */
  children: (remainingSeconds: number) => React.ReactNode
}

export function CountdownTimer({ expiryMs, onExpired, children }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((expiryMs - Date.now()) / 1000))
  )

  useEffect(() => {
    if (remaining <= 0) return

    const interval = setInterval(() => {
      const newRemaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000))
      setRemaining(newRemaining)
      if (newRemaining <= 0) {
        clearInterval(interval)
        onExpired?.()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [expiryMs, onExpired, remaining])

  return <>{children(remaining)}</>
}
