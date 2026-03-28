import { useState } from 'react'
import cardLogo from '@/assets/card-logo.svg'

interface MintIconProps {
  iconUrl?: string
  /** Image size class (default: "w-6 h-6") */
  imgSize?: string
  /** Additional classes on the outer container */
  className?: string
}

/**
 * Mint icon with automatic cardLogo fallback.
 * Renders a flex container with the icon image inside.
 * Pass className to control container size/shape/bg (e.g. "w-9 h-9 rounded-[10px] bg-brand/10").
 */
export function MintIcon({ iconUrl, imgSize = 'w-6 h-6', className = '' }: MintIconProps) {
  const [hasError, setHasError] = useState(false)

  return (
    <div className={`overflow-hidden shrink-0 flex items-center justify-center ${className}`}>
      <img
        src={!iconUrl || hasError ? cardLogo : iconUrl}
        alt=""
        className={`${imgSize} object-contain`}
        onError={() => setHasError(true)}
      />
    </div>
  )
}
