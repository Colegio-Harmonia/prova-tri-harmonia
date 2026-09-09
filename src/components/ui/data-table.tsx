'use client'

import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type RowData,
  useTable,
} from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/cn'

/** Shared TanStack capabilities used by every ProvaTRI data table. */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
})

export type DataTableFeatures = typeof dataTableFeatures
export type DataTableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData>

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumnDef<TData>[]
  data: TData[]
  searchableColumnId?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
}

/**
 * Reusable, client-side data table with optional search, sortable columns and pagination.
 * Define columns with `createColumnHelper<DataTableFeatures, TData>()`.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  searchableColumnId,
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'Nenhum resultado encontrado.',
  className,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
  })

  const searchableColumn = searchableColumnId ? table.getColumn(searchableColumnId) : undefined
  const filteredRowCount = table.getFilteredRowModel().rows.length

  return (
    <div className={cn('space-y-4', className)}>
      {searchableColumn && (
        <Input
          aria-label={searchPlaceholder}
          className="max-w-sm"
          placeholder={searchPlaceholder}
          value={(searchableColumn.getFilterValue() as string | undefined) ?? ''}
          onChange={(event) => searchableColumn.setFilterValue(event.target.value)}
        />
      )}

      <div className="overflow-hidden rounded border border-border bg-surface">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortDirection = header.column.getIsSorted()

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={sortDirection === 'asc' ? 'ascending' : sortDirection === 'desc' ? 'descending' : 'none'}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="-mx-2 inline-flex min-h-8 items-center gap-1 rounded px-2 text-left hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-focus/25"
                          onClick={() => header.column.toggleSorting()}
                        >
                          <table.FlexRender header={header} />
                          <span aria-hidden="true" className="text-content-muted">
                            {sortDirection === 'asc' ? '↑' : sortDirection === 'desc' ? '↓' : '↕'}
                          </span>
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-content-muted">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-content-secondary sm:flex-row sm:items-center sm:justify-between">
        <span>{filteredRowCount} {filteredRowCount === 1 ? 'resultado' : 'resultados'}</span>
        <div className="flex items-center gap-2">
          <span className="text-content-muted">Página {table.state.pagination.pageIndex + 1} de {table.getPageCount()}</span>
          <Button variant="secondary" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Anterior
          </Button>
          <Button variant="secondary" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}
