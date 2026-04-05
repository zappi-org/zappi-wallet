import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ServiceProvider } from '@/hooks/service-context'
import { useServiceRegistry } from '@/hooks/use-service-registry'
import type { ServiceRegistry } from '@/composition/types'
import type { ReactNode } from 'react'

function createMockRegistry(): ServiceRegistry {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      off: vi.fn(),
    },
    payment: {
      getAccounts: vi.fn(),
      getMethodsForAccount: vi.fn(),
      send: vi.fn(),
      receive: vi.fn(),
      redeem: vi.fn(),
      estimateFee: vi.fn(),
      recoverAll: vi.fn(),
    } as unknown as ServiceRegistry['payment'],
    balance: {
      getTotal: vi.fn(),
      getByModule: vi.fn(),
    } as unknown as ServiceRegistry['balance'],
    swap: {
      getAvailableSwaps: vi.fn(),
      estimateSwap: vi.fn(),
      executeSwap: vi.fn(),
    } as unknown as ServiceRegistry['swap'],
    contact: {
      list: vi.fn(),
      getById: vi.fn(),
      findByAddress: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as ServiceRegistry['contact'],
    inputRouter: {
      classify: vi.fn(),
    } as unknown as ServiceRegistry['inputRouter'],
    addressResolver: {
      resolve: vi.fn(),
    } as unknown as ServiceRegistry['addressResolver'],
  }
}

describe('ServiceContext', () => {
  it('should provide ServiceRegistry to children', () => {
    const mockRegistry = createMockRegistry()

    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServiceProvider registry={mockRegistry}>{children}</ServiceProvider>
    )

    const { result } = renderHook(() => useServiceRegistry(), { wrapper })

    expect(result.current).toBe(mockRegistry)
    expect(result.current.payment).toBe(mockRegistry.payment)
    expect(result.current.balance).toBe(mockRegistry.balance)
    expect(result.current.swap).toBe(mockRegistry.swap)
    expect(result.current.contact).toBe(mockRegistry.contact)
    expect(result.current.eventBus).toBe(mockRegistry.eventBus)
  })

  it('should throw when used outside ServiceProvider', () => {
    // Suppress expected console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useServiceRegistry())
    }).toThrow('useServiceRegistry must be used within ServiceProvider')

    spy.mockRestore()
  })
})
