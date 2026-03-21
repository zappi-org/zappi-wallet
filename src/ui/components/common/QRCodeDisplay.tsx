import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'

export interface QRCodeDisplayProps {
  value: string
  size?: number
  className?: string
}

export function QRCodeDisplay({
  value,
  size = 200,
  className,
}: QRCodeDisplayProps) {
  return (
    <div className={cn('bg-background-card p-4 rounded-[13px] shadow-sm', className)}>
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        includeMargin={false}
      />
    </div>
  )
}
