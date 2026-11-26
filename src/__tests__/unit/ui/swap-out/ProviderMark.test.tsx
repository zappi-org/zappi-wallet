import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderMark } from '@/ui/components/payment/ProviderMark'

describe('ProviderMark', () => {
  it('renders the identifier mark as an svg sized to the hallmark aspect', () => {
    render(<ProviderMark identifier="npub1provider" width={25} />)
    const host = screen.getByTestId('provider-mark')
    const svg = host.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('viewBox')).toBe('0 0 100 132')
    expect(svg!.getAttribute('width')).toBe('25')
    expect(svg!.getAttribute('height')).toBe('33')
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
  })

  it('draws the same mark for the same identifier and a different one otherwise', () => {
    const { rerender } = render(<ProviderMark identifier="npub1first" />)
    const first = screen.getByTestId('provider-mark').innerHTML
    rerender(<ProviderMark identifier="npub1second" />)
    const second = screen.getByTestId('provider-mark').innerHTML
    rerender(<ProviderMark identifier="npub1first" />)
    expect(screen.getByTestId('provider-mark').innerHTML).toBe(first)
    expect(second).not.toBe(first)
    expect(screen.getByTestId('provider-mark').querySelectorAll('svg')).toHaveLength(1)
  })
})
