import type { ReactNode, PointerEvent, KeyboardEvent } from 'react'
import { GripVertical } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { cn } from '@/ui/primitives/utils'

interface ReorderableSettingItemProps {
  value: string
  dragTitle: string
  handleTestId: string
  onDragEnd: () => void | Promise<void>
  onMoveUp?: () => void | Promise<void>
  onMoveDown?: () => void | Promise<void>
  canMoveUp?: boolean
  canMoveDown?: boolean
  children: (dragHandle: ReactNode) => ReactNode
}

export function ReorderableSettingItem({
  value,
  dragTitle,
  handleTestId,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  children,
}: ReorderableSettingItemProps) {
  const dragControls = useDragControls()

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    dragControls.start(event)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && canMoveUp && onMoveUp) {
      event.preventDefault()
      event.stopPropagation()
      void onMoveUp()
      return
    }

    if (event.key === 'ArrowDown' && canMoveDown && onMoveDown) {
      event.preventDefault()
      event.stopPropagation()
      void onMoveDown()
    }
  }

  const dragHandle = (
    <button
      type="button"
      aria-label={dragTitle}
      aria-disabled={!canMoveUp && !canMoveDown}
      aria-keyshortcuts="ArrowUp ArrowDown"
      data-testid={handleTestId}
      title={dragTitle}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'flex w-10 shrink-0 items-center justify-center self-stretch text-foreground-muted/55',
        'cursor-grab touch-none active:cursor-grabbing active:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35',
      )}
    >
      <GripVertical className="h-4 w-4" strokeWidth={1.8} />
    </button>
  )

  const handleDragEnd = () => {
    Promise.resolve(onDragEnd()).catch((error) => {
      console.error('[ReorderableSettingItem] Failed to persist reordered item:', error)
    })
  }

  return (
    <Reorder.Item
      as="div"
      value={value}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={handleDragEnd}
      className="bg-background-card"
    >
      {children(dragHandle)}
    </Reorder.Item>
  )
}
