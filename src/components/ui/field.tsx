import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type FieldProps = HTMLAttributes<HTMLDivElement> & {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}

export function Field({
  className,
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  ...props
}: FieldProps) {
  return (
    <div {...props} className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-content-primary">
        {label}
        {required && <span aria-hidden="true" className="ml-1 text-status-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
