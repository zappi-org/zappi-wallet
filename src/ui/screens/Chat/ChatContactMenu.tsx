import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Ellipsis, Pencil, UserRoundPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ChatContactMenu({
  known,
  onContact,
  actions = [],
}: {
  known: boolean
  onContact?: () => void
  actions?: Array<{
    key: string
    label: string
    icon: ReactNode
    onSelect: () => void
    danger?: boolean
  }>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={t('chat.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="size-11 flex items-center justify-center rounded-full active:bg-foreground/5"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Ellipsis size={23} />
      </button>
      {open && (
        <div
          role="menu"
          id={menuId}
          aria-label={t('chat.actions')}
          className="absolute right-0 top-full z-30 min-w-52 max-h-[60vh] overflow-y-auto overscroll-contain rounded-xl bg-background-card p-1 shadow-lg ring-1 ring-border"
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]'
              )
            )
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement
            )
            const next =
              event.key === 'ArrowDown'
                ? (index + 1) % items.length
                : event.key === 'ArrowUp'
                ? (index - 1 + items.length) % items.length
                : event.key === 'Home'
                ? 0
                : event.key === 'End'
                ? items.length - 1
                : -1
            if (next >= 0) {
              event.preventDefault()
              items[next]?.focus({ preventScroll: true })
            }
            if (event.key === 'Tab') {
              setOpen(false)
              trigger.current?.focus({ preventScroll: true })
            }
          }}
        >
          {onContact && (
            <button
              role="menuitem"
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-body text-left hover:bg-foreground/5 focus-visible:bg-foreground/5 outline-none"
              onClick={() => {
                setOpen(false)
                onContact()
              }}
            >
              {known ? <Pencil size={18} /> : <UserRoundPlus size={18} />}
              {t(known ? 'contacts.editContact' : 'contacts.addContact')}
            </button>
          )}{' '}
          {actions.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              type="button"
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-body text-left hover:bg-foreground/5 focus-visible:bg-foreground/5 outline-none ${
                item.danger ? 'text-accent-danger' : ''
              }`}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
