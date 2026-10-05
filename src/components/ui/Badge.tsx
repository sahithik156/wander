import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
type Size = 'default' | 'sm' | 'lg'

/*
 * Small square labels, like a printed guide: 1px border, sentence case,
 * regular weight, no fill. Only "destructive" changes color.
 */
const VARIANTS: Record<Variant, string> = {
  default: 'border-ink text-foreground',
  secondary: 'border-rule text-muted-foreground',
  destructive: 'border-destructive text-destructive',
  outline: 'border-ink text-foreground',
  success: 'border-ink text-foreground',
  warning: 'border-ink text-foreground',
  info: 'border-ink text-foreground',
}

const SIZES: Record<Size, string> = {
  default: 'px-2 py-0.5 text-xs',
  sm: 'px-1.5 py-px text-[11px]',
  lg: 'px-2.5 py-1 text-sm',
}

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: Variant
  size?: Size
}

export function Badge({ className, variant = 'default', size = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border font-normal leading-normal',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
