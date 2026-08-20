import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The button primitive (§12.1).
 *
 * shadcn/ui components are owned in this repository and edited here — they are
 * not wrapped in another abstraction layer (CLAUDE.md §16). Written without
 * `class-variance-authority`, which is not in the frozen stack (§17.1).
 *
 * `h-11` is deliberate: §12.1 asks for large touch targets, and 44px is the
 * smallest a thumb reliably hits on a phone in a showroom.
 */
const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
  outline: 'border border-input bg-background hover:bg-accent',
  ghost: 'hover:bg-accent',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
} as const

const SIZES = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-12 px-6 text-base',
  icon: 'h-11 w-11',
} as const

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}

/** The same surface as a link, for navigation that looks like an action. */
export function buttonClass(
  variant: keyof typeof VARIANTS = 'primary',
  size: keyof typeof SIZES = 'md',
  className?: string,
) {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}
