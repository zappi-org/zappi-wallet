import { useEffect, useState } from 'react'

/**
 * Height (px) the soft keyboard covers at the bottom of the layout viewport.
 * WHY: this is a PWA with no native wrapper, so VisualViewport is the only way
 * to observe the keyboard — the layout viewport does not shrink on iOS Safari.
 * In full-bleed standalone iOS reports visualViewport.height minus safe-area
 * insets even with no keyboard (WebKit 254868) — measured phantoms range up
 * to the status-bar height (62px on Dynamic Island). Real soft keyboards are
 * 216px+, so the floor filters every phantom; the ~55px hardware-keyboard
 * accessory bar is knowingly sacrificed (it falls between the two). */
const MIN_KEYBOARD_PX = 100

export function computeInset(innerHeight: number, vv: { height: number; offsetTop: number }): number {
  const raw = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))
  return raw < MIN_KEYBOARD_PX ? 0 : raw
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(computeInset(window.innerHeight, { height: vv.height, offsetTop: vv.offsetTop }))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
