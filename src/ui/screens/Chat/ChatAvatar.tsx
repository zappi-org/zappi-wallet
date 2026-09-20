export function ChatAvatar({
  name,
  size = 'normal',
}: {
  name: string
  size?: 'normal' | 'small'
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand font-semibold ${
        size === 'small' ? 'size-8 text-xs' : 'size-12 text-lg'
      }`}
      aria-hidden="true"
    >
      {Array.from(name).slice(0, 2).join('').toUpperCase()}
    </span>
  )
}
