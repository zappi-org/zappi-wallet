import { ShieldCheck } from 'lucide-react'
import { type ReactNode } from 'react'

interface CSSecurityNoticeProps {
  title: ReactNode
  description: ReactNode
}

export function CSSecurityNotice({ title, description }: CSSecurityNoticeProps) {
  return (
    <div className="flex items-start gap-2 bg-brand-50 rounded-[10px] px-3 py-2.5">
      <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand" strokeWidth={1.8} />
      <p className="text-[11.5px] leading-[1.5] tracking-[-0.005em] text-brand-900">
        <strong className="font-semibold">{title}</strong> {description}
      </p>
    </div>
  )
}
