import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'

const CSV = [
  'Codigo Propio;Descripcion;Costo;Iva;Publico;Fecha Actualizacion',
  '31884325;Protectores demo;712;21;1200;23/07/2026',
  '1002;Leche demo;400;10,5;550;01/03/2025',
  '001;Harina vieja demo;337;21;550;26/02/2019',
  '777;Ya importado demo;1;21;2;01/03/2025',
  '1004;Sin precio demo;1;21;0;01/03/2025',
].join('\n')

function setup(role: 'manager' | 'staff' = 'manager') {
  const fake = createFakeSupabase(fakeSession(), { role })
  fake.setTable('products', [{ id: 'p-777', legacy_code: '777' }])
  fake.setTable('categories', [{ id: 'cat-sc', name: 'Sin clasificar' }])
  fake.setTable('brands', [])
  fake.setRpcResult('create_product', { id: 'nuevo', sku: '000100', name: 'x' })
  const router = renderApp('/productos/importar', fake.client)
  return { fake, router, user: userEvent.setup() }
}

async function upload(user: ReturnType<typeof userEvent.setup>, content = CSV, name = 'stock.csv') {
  const input = await screen.findByLabelText('Archivo CSV')
  await user.upload(input, new File([content], name, { type: 'text/csv' }))
}

describe('importar productos del sistema anterior', () => {
  it('resume el archivo: filtra por fecha, saltea los ya importados y muestra problemas', async () => {
    const { user } = setup()
    await upload(user)
    const summary = await screen.findByText('Filas en el archivo')
    const dl = summary.closest('dl') as HTMLElement
    expect(within(dl).getAllByRole('definition').map((d) => d.textContent)).toEqual(['5', '1', '1', '1', '2'])
    expect(screen.getByRole('button', { name: 'Importar 2 productos' })).toBeInTheDocument()
    const preview = screen.getByRole('table', { name: /Vista previa/ })
    expect(within(preview).getByText('Protectores demo')).toBeInTheDocument()
    expect(within(preview).getByText('Leche demo')).toBeInTheDocument()
    expect(within(preview).queryByText('Harina vieja demo')).not.toBeInTheDocument()
  })

  it('sin fecha de corte incluye lo viejo', async () => {
    const { user } = setup()
    await upload(user)
    await user.clear(await screen.findByLabelText(/Solo actualizados desde/))
    expect(screen.getByRole('button', { name: 'Importar 3 productos' })).toBeInTheDocument()
  })

  it('importa con precio sin IVA de 4 decimales, código anterior y "Sin clasificar"', async () => {
    const { user, fake } = setup()
    await upload(user)
    await user.click(await screen.findByRole('button', { name: 'Importar 2 productos' }))
    const dialog = screen.getByRole('dialog', { name: 'Confirmar importación' })
    await user.click(within(dialog).getByRole('button', { name: 'Importar 2' }))
    expect(await screen.findByRole('heading', { name: 'Importación terminada' })).toBeInTheDocument()
    expect(screen.getByText(/2 de 2 · creados 2 · con error 0/)).toBeInTheDocument()

    const calls = fake.rpc.mock.calls.filter(([name]) => name === 'create_product') as [string, Record<string, unknown>][]
    expect(calls).toHaveLength(2)
    const first = calls.find(([, p]) => p.p_legacy_code === '31884325')?.[1]
    expect(first).toMatchObject({
      p_name: 'Protectores demo',
      p_cost_price: 712,
      p_sale_price: 991.7355,
      p_vat_rate: 21,
      p_sale_unit: 'unit',
      p_category_id: 'cat-sc',
    })
    expect(first?.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    // La marca "Sin clasificar" no existía: se crea.
    expect(fake.writes).toContainEqual(expect.objectContaining({ table: 'brands', op: 'insert', payload: { name: 'Sin clasificar' } }))
  })

  it('un archivo que no es CSV lo explica', async () => {
    const { user } = setup()
    await upload(user, 'x', 'stock.xlsx')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Guardar como/)
  })

  it('un error en un producto no corta el resto y se lista', async () => {
    const { user, fake } = setup()
    fake.setRpcResult('create_product', null, {
      code: '23505',
      message: 'duplicate key value violates unique constraint "products_legacy_code_key"',
    })
    await upload(user)
    await user.click(await screen.findByRole('button', { name: 'Importar 2 productos' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Importar 2' }))
    expect(await screen.findByText(/2 de 2 · creados 0 · con error 2/)).toBeInTheDocument()
    expect(screen.getAllByText(/Ya existe un producto con ese código anterior/)).toHaveLength(2)
  })

  it('el empleado no puede entrar', async () => {
    setup('staff')
    expect(await screen.findByText('No tenés permiso para esta sección')).toBeInTheDocument()
  })

  it('el listado de productos ofrece "Importar" al encargado', async () => {
    const fake = createFakeSupabase(fakeSession(), { role: 'manager' })
    fake.setTable('v_product_list', [])
    const router = renderApp('/productos', fake.client)
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Importar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/productos/importar'))
  })
})

