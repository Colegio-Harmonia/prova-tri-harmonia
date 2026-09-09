import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  hasError?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, hasError = false, ...props },
  ref,
) {
  const isInvalid = hasError || props['aria-invalid'] === true || props['aria-invalid'] === 'true'

  return (
    <input
      {...props}
      ref={ref}
      aria-invalid={isInvalid || undefined}
      className={cn(
        'min-h-10 w-full rounded border bg-surface px-3 py-2 text-sm text-content-primary placeholder:text-content-muted transition-colors duration-fast ease-productive',
        'hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-content-muted',
        hasError && 'border-action-danger focus:border-action-danger focus:ring-action-danger/25',
        className,
      )}
    />
  )
})

Input.displayName = 'Input'
