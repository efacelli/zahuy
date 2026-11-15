import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { validateNewPassword } from './password'

describe('primer ingreso: elegir contraseña', () => {
  it('si la cuenta tiene la marca, pide la contraseña nueva antes de entrar', async () => {
    const fake = createFakeSupabase(fakeSession('nuevo@zahuy.test', { must_change_password: true }), { role: 'manager' })
    renderApp('/productos', fake.client)
    expect(await screen.findByRole('heading', { name: 'Elegí tu contraseña' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1, name: 'Productos' })).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/^Contraseña nueva/), 'MiClave2026')
    await user.type(screen.getByLabelText(/^Repetir/), 'MiClave2026')
    await user.click(screen.getByRole('button', { name: 'Guardar y entrar' }))

    await waitFor(() =>
      expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'MiClave2026', data: { must_change_password: false } }),
    )
    // Sin la marca, entra a la pantalla que pidió.
    expect(await screen.findByRole('heading', { level: 1, name: 'Productos' })).toBeInTheDocument()
  })

  it('valida antes de guardar', async () => {
    const fake = createFakeSupabase(fakeSession('nuevo@zahuy.test', { must_change_password: true }))
    renderApp('/productos', fake.client)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/^Contraseña nueva/), 'corta')
    await user.click(screen.getByRole('button', { name: 'Guardar y entrar' }))
    expect(screen.getByText('Tiene que tener al menos 10 caracteres.')).toBeInTheDocument()
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it('sin la marca entra directo', async () => {
    const fake = createFakeSupabase(fakeSession())
    renderApp('/productos', fake.client)
    expect(await screen.findByRole('heading', { level: 1, name: 'Productos' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Elegí tu contraseña' })).not.toBeInTheDocument()
  })

  it('reglas: 10 caracteres, letras y números, repetida igual', () => {
    expect(validateNewPassword('MiClave2026', 'MiClave2026')).toEqual({})
    expect(validateNewPassword('soloLetrasAqui', 'soloLetrasAqui').next).toMatch(/letras y números/)
    expect(validateNewPassword('MiClave2026', 'Otra').repeat).toMatch(/No coincide/)
  })
})
