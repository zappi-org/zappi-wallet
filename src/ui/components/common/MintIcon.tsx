import { useState } from 'react'
import cardLogo from '@/assets/card-logo.svg'

interface MintIconProps {
  iconUrl?: string
  /** Image size class (default: "w-6 h-6") */
  imgSize?: string
  /** Additional classes on the outer container */
  className?: string
  /** Force a perfectly circular crop (rounded-full + object-cover). */
  circle?: boolean
}

/**
 * Mint icon with automatic cardLogo fallback.
 * Renders a flex container with the icon image inside.
 * Pass className to control container size/shape/bg (e.g. "w-9 h-9 rounded-[10px] bg-brand/10").
 */
export function MintIcon({
  iconUrl,
  imgSize = 'w-6 h-6',
  className = '',
  circle = false,
}: MintIconProps) {
  const [hasError, setHasError] = useState(false)
  const containerShape = circle ? 'rounded-full' : ''
  const imgFit = circle ? 'object-cover' : 'object-contain'

  return (
    <div className={`overflow-hidden shrink-0 flex items-center justify-center ${containerShape} ${className}`}>
      <img
        src={!iconUrl || hasError ? cardLogo : iconUrl}
        alt=""
        className={`${imgSize} ${imgFit}`}
        onError={() => setHasError(true)}
      />
    </div>
  )
}
