import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { passwordErrorMessage, validateChangePassword } from './password'

describe('reglas de contraseña', () => {
  it('10 caracteres, letras y números, distinta de la actual y repetida igual', () => {
    const ok = { current: 'Vieja12345', next: 'Nueva12345', repeat: 'Nueva12345' }
    expect(validateChangePassword(ok)).toEqual({})
    expect(validateChangePassword({ ...ok, next: 'Corta1', repeat: 'Corta1' }).next).toMatch(/10 caracteres/)
    expect(validateChangePassword({ ...ok, next: 'sololetrasaa', repeat: 'sololetrasaa' }).next).toMatch(/letras y números/)
    expect(validateChangePassword({ ...ok, next: '1234567890', repeat: '1234567890' }).next).toMatch(/letras y números/)
    expect(validateChangePassword({ ...ok, next: 'Vieja12345', repeat: 'Vieja12345' }).next).toMatch(/distinta/)
    expect(validateChangePassword({ ...ok, repeat: 'Otra123456' }).repeat).toMatch(/No coincide/)
    expect(validateChangePassword({ ...ok, current: '' }).current).toBeDefined()
  })

  it('traduce los errores de Supabase Auth', () => {
    expect(passwordErrorMessage({ code: 'invalid_credentials' })).toMatch(/actual no es correcta/)
    expect(passwordErrorMessage({ code: 'weak_password' })).toMatch(/débil/)
    expect(passwordErrorMessage({ code: 'same_password' })).toMatch(/distinta/)
    expect(passwordErrorMessage(null)).toMatch(/No se pudo/)
  })
})

describe('Cambiar mi contraseña', () => {
  function setup() {
    const fake = createFakeSupabase(fakeSession('empleado@zahuy.test'), { role: 'staff' })
    renderApp('/productos', fake.client)
    return { fake, user: userEvent.setup() }
  }

  async function open(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Contraseña' }))
    return screen.getByRole('dialog', { name: 'Cambiar mi contraseña' })
  }

  it('comprueba la actual y cambia la contraseña', async () => {
    const { user, fake } = setup()
    const dialog = await open(user)
    await user.type(within(dialog).getByLabelText(/^Contraseña actual/), 'Vieja12345')
    await user.type(within(dialog).getByLabelText(/^Contraseña nueva/), 'Nueva12345')
    await user.type(within(dialog).getByLabelText(/^Repetir/), 'Nueva12345{Enter}')
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: 'Nueva12345' }))
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'empleado@zahuy.test', password: 'Vieja12345' })
    expect(await screen.findByText('Tu contraseña cambió. Usala la próxima vez que ingreses.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Cambiar mi contraseña' })).not.toBeInTheDocument()
  })

  it('si la actual es incorrecta no cambia nada', async () => {
    const { user, fake } = setup()
    const dialog = await open(user)
    await user.type(within(dialog).getByLabelText(/^Contraseña actual/), 'incorrecta')
    await user.type(within(dialog).getByLabelText(/^Contraseña nueva/), 'Nueva12345')
    await user.type(within(dialog).getByLabelText(/^Repetir/), 'Nueva12345')
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta.')
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it('valida antes de llamar a la base', async () => {
    const { user, fake } = setup()
    const dialog = await open(user)
    await user.type(within(dialog).getByLabelText(/^Contraseña actual/), 'Vieja12345')
    await user.type(within(dialog).getByLabelText(/^Contraseña nueva/), 'corta')
    await user.click(within(dialog).getByRole('button', { name: 'Cambiar' }))
    expect(within(dialog).getByText('Tiene que tener al menos 10 caracteres.')).toBeInTheDocument()
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
