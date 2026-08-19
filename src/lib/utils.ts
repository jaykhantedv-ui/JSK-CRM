import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names, resolving Tailwind conflicts.
 * Required by shadcn/ui, which is part of the frozen stack (§17.1).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
