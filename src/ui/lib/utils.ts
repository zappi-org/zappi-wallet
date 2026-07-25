import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-display', 'text-amount-lg', 'text-amount',
        'text-heading', 'text-title', 'text-title-sm', 'text-subtitle',
        'text-body', 'text-body-bold',
        'text-caption', 'text-label', 'text-overline',
      ],
      // Theme widths must join their group, or a caller's max-w-* lands
      // alongside them and CSS order — not the caller — picks the winner.
      'max-w': ['max-w-qr'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
