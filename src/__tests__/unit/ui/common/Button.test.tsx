import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '@/ui/components/common/Button'

// The button merges its classes (tailwind-merge) so a caller can override the
// variant/size defaults. Two invariants that merge must not break:
describe('Button class merging', () => {
  it('lets a caller override the default weight', () => {
    render(<Button variant="brand" className="font-medium">또 만들기</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('font-medium')
    expect(cls).not.toContain('font-semibold')
  })

  // Weight follows the role, not the size: the deciding action is semibold at
  // any size, the quiet one stays medium at any size.
  it('gives weight to the deciding action, not to the quiet one', () => {
    const { rerender } = render(<Button variant="brand" size="xl">보내기</Button>)
    expect(screen.getByRole('button').className).toContain('font-semibold')

    rerender(<Button variant="secondary" size="xl">취소</Button>)
    const quiet = screen.getByRole('button').className
    expect(quiet).toContain('font-medium')
    expect(quiet).not.toContain('font-semibold')
  })

  it('keeps shrink-0 even when the caller passes flex-1', () => {
    render(<Button className="flex-1">확인</Button>)
    expect(screen.getByRole('button').className).toContain('shrink-0')
  })

  // A disabled button must not look tappable; a loading one is busy, not
  // unavailable, so it keeps its variant skin behind the spinner.
  it('swaps the variant skin out when disabled', () => {
    render(<Button variant="brand" disabled>보내기</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('disabled:bg-foreground/[0.035]')
    expect(cls).toContain('disabled:shadow-none')
  })

  it('keeps the variant skin while loading', () => {
    render(<Button variant="brand" loading>보내기</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).not.toContain('disabled:bg-foreground/[0.035]')
    expect(cls).toContain('bg-brand')
  })
})
