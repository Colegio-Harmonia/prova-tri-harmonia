import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section {...props} className={cn('rounded-lg border border-border bg-surface p-5 shadow-soft', className)} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={cn('font-display text-xl font-semibold tracking-tight text-content-primary', className)} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={cn('mt-1 text-sm leading-6 text-content-secondary', className)} />
}
