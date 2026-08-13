import { useEffect, useState } from 'react'

/**
 * Height (px) the soft keyboard covers at the bottom of the layout viewport.
 * VisualViewport is the only way to observe the keyboard in a PWA. Full-bleed
 * standalone reports phantom insets up to the status-bar height with no
 * keyboard; real keyboards are 216px+, so the floor filters every phantom
 * (the ~55px hardware-keyboard accessory bar is knowingly sacrificed). */
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
