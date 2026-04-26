export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items
  }

  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

export function isSameOrder<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

export function reconcileOrder<T>(localOrder: T[], sourceOrder: T[]): T[] {
  if (isSameOrder(localOrder, sourceOrder)) {
    return localOrder
  }

  const sourceSet = new Set(sourceOrder)
  const retained = localOrder.filter((item) => sourceSet.has(item))
  const missing = sourceOrder.filter((item) => !retained.includes(item))
  return [...retained, ...missing]
}
