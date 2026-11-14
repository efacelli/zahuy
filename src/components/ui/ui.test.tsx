import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'
import { DataTable, type Column } from './DataTable'
import { Pagination } from './Pagination'

describe('ConfirmDialog', () => {
  it('confirma y cancela', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Registrar merma" confirmLabel="Registrar" onConfirm={onConfirm} onCancel={onCancel}>
        Se descontarán 3 unidades del lote L-01.
      </ConfirmDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Registrar merma' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Registrar' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('cierra con Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="X" confirmLabel="OK" onConfirm={vi.fn()} onCancel={onCancel}>
        Texto
      </ConfirmDialog>,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('mientras envía, no permite confirmar dos veces ni cerrar', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open busy title="X" confirmLabel="OK" onConfirm={onConfirm} onCancel={onCancel}>
        Texto
      </ConfirmDialog>,
    )
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('no renderiza nada cerrado', () => {
    render(
      <ConfirmDialog open={false} title="X" confirmLabel="OK" onConfirm={vi.fn()} onCancel={vi.fn()}>
        Texto
      </ConfirmDialog>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

interface Row {
  id: string
  name: string
}

const columns: Column<Row, 'name'>[] = [{ key: 'name', header: 'Nombre', render: (r) => r.name, sortable: true }]

describe('DataTable', () => {
  it('muestra estado vacío', () => {
    render(<DataTable caption="Productos" columns={columns} rows={[]} rowKey={(r) => r.id} emptyTitle="Sin productos" />)
    expect(screen.getByText('Sin productos')).toBeInTheDocument()
  })

  it('muestra error con reintento', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <DataTable caption="P" columns={columns} rows={[]} rowKey={(r) => r.id} errorMessage="Sin conexión" onRetry={onRetry} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('alterna el orden y lo expone con aria-sort', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    const rows = [{ id: '1', name: 'Yogur' }]
    const { rerender } = render(
      <DataTable caption="P" columns={columns} rows={rows} rowKey={(r) => r.id} sort={null} onSortChange={onSortChange} />,
    )
    expect(screen.getByRole('columnheader', { name: /Nombre/ })).toHaveAttribute('aria-sort', 'none')
    await user.click(screen.getByRole('button', { name: /Nombre/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'asc' })

    rerender(
      <DataTable
        caption="P"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    )
    expect(screen.getByRole('columnheader', { name: /Nombre/ })).toHaveAttribute('aria-sort', 'ascending')
    await user.click(screen.getByRole('button', { name: /Nombre/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'name', direction: 'desc' })
  })
})

describe('Pagination', () => {
  it('muestra el rango y deshabilita los extremos', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<Pagination page={1} pageSize={25} total={60} onPageChange={onPageChange} />)
    expect(screen.getByText('Mostrando 1–25 de 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('última página', () => {
    render(<Pagination page={3} pageSize={25} total={60} onPageChange={vi.fn()} />)
    expect(screen.getByText('Mostrando 51–60 de 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  })
})
