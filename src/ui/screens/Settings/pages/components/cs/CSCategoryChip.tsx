interface CSCategoryChipProps {
  label: string
}

export function CSCategoryChip({ label }: CSCategoryChipProps) {
  return (
    <span className="inline-flex items-center rounded-full bg-background-card border border-border px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[-0.005em] text-brand-900">
      {label}
    </span>
  )
}
