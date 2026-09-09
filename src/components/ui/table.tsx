import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(function Table(
  { className, ...props },
  ref,
) {
  return (
    <div className="w-full overflow-x-auto">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
})

Table.displayName = 'Table'

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableHeader({ className, ...props }, ref) {
    return <thead ref={ref} className={cn('border-b border-border bg-surface-subtle text-content-secondary', className)} {...props} />
  },
)

TableHeader.displayName = 'TableHeader'

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className, ...props }, ref) {
    return <tbody ref={ref} className={cn('divide-y divide-border', className)} {...props} />
  },
)

TableBody.displayName = 'TableBody'

export const TableFooter = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableFooter({ className, ...props }, ref) {
    return <tfoot ref={ref} className={cn('border-t border-border bg-surface-subtle font-medium', className)} {...props} />
  },
)

TableFooter.displayName = 'TableFooter'

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return <tr ref={ref} className={cn('transition-colors hover:bg-surface-subtle data-[state=selected]:bg-surface-subtle', className)} {...props} />
  },
)

TableRow.displayName = 'TableRow'

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className, ...props }, ref) {
    return <th ref={ref} className={cn('h-11 px-4 text-left align-middle text-xs font-medium uppercase tracking-wide', className)} {...props} />
  },
)

TableHead.displayName = 'TableHead'

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className, ...props }, ref) {
    return <td ref={ref} className={cn('px-4 py-3 align-middle text-content-secondary', className)} {...props} />
  },
)

TableCell.displayName = 'TableCell'

export const TableCaption = forwardRef<HTMLTableCaptionElement, HTMLAttributes<HTMLTableCaptionElement>>(
  function TableCaption({ className, ...props }, ref) {
    return <caption ref={ref} className={cn('mt-4 text-sm text-content-muted', className)} {...props} />
  },
)

TableCaption.displayName = 'TableCaption'
