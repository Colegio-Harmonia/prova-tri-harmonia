import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-action-primary text-action-primary-foreground shadow-soft hover:bg-action-primary-hover',
  secondary: 'border border-border bg-surface text-content-primary hover:border-border-strong hover:bg-surface-subtle',
  quiet: 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
  danger: 'bg-action-danger text-content-inverse shadow-soft hover:bg-action-danger-hover',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-10 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  loadingLabel?: string
  children: ReactNode
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel = 'Carregando',
  disabled,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded font-semibold transition-colors duration-fast ease-productive disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {loading && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  )
}
