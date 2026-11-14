import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, fakeSession } from '../../test/fakeSupabase'
import { renderApp } from '../../test/renderApp'
import { toAuthError } from './auth-errors'
import { loginPath, safeRedirectPath } from './redirect'

describe('rutas protegidas', () => {
  it('sin sesión redirige al login guardando a dónde volver', async () => {
    const router = renderApp('/alertas', createFakeSupabase(null).client)
    await screen.findByRole('heading', { name: 'Ingresar al sistema' })
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('?volver=%2Falertas')
  })

  it('con sesión muestra la app', async () => {
    renderApp('/', createFakeSupabase(fakeSession()).client)
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('con sesión, /login lleva directo a la app', async () => {
    const router = renderApp('/login', createFakeSupabase(fakeSession()).client)
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('LoginPage', () => {
  it('valida los campos antes de enviar', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase(null)
    renderApp('/login', fake.client)
    await user.click(await screen.findByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('Ingresá tu email.')).toBeInTheDocument()
    expect(screen.getByText('Ingresá tu contraseña.')).toBeInTheDocument()
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/Email/), 'no-es-un-email')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('El email no es válido.')).toBeInTheDocument()
  })

  it('ingresa y vuelve a la sección pedida', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase(null)
    const router = renderApp('/login?volver=%2Falertas', fake.client)
    await user.type(await screen.findByLabelText(/Email/), '  encargado@prueba.test ')
    await user.type(screen.getByLabelText(/Contraseña/), 'clave-de-prueba')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    await screen.findByRole('heading', { level: 1, name: 'Alertas' })
    expect(router.state.location.pathname).toBe('/alertas')
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'encargado@prueba.test',
      password: 'clave-de-prueba',
    })
  })

  it('muestra un error claro con credenciales inválidas', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase(null)
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
    } as never)
    renderApp('/login', fake.client)
    await user.type(await screen.findByLabelText(/Email/), 'x@prueba.test')
    await user.type(screen.getByLabelText(/Contraseña/), 'mala')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.')
  })

  it('permite mostrar la contraseña', async () => {
    const user = userEvent.setup()
    renderApp('/login', createFakeSupabase(null).client)
    const input = await screen.findByLabelText(/Contraseña/)
    expect(input).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(input).toHaveAttribute('type', 'text')
  })
})

describe('cierre de sesión', () => {
  it('el botón Salir cierra la sesión y vuelve al login', async () => {
    const user = userEvent.setup()
    const fake = createFakeSupabase(fakeSession('encargado@prueba.test'))
    const router = renderApp('/', fake.client)
    expect(await screen.findByText(/Usuario de prueba/)).toHaveTextContent('Usuario de prueba · Encargado')
    await user.click(screen.getByRole('button', { name: 'Salir' }))
    await screen.findByRole('heading', { name: 'Ingresar al sistema' })
    expect(router.state.location.pathname).toBe('/login')
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(screen.queryByText(/Tu sesión terminó/)).not.toBeInTheDocument()
  })

  it('si la sesión expira, avisa al volver al login', async () => {
    const fake = createFakeSupabase(fakeSession())
    renderApp('/productos', fake.client)
    await screen.findByRole('heading', { level: 1, name: 'Productos' })
    act(() => fake.expireSession())
    await waitFor(() => expect(screen.getByText(/Tu sesión terminó/)).toBeInTheDocument())
  })
})

describe('safeRedirectPath', () => {
  it('acepta solo rutas internas', () => {
    expect(safeRedirectPath('/alertas?nivel=urgent')).toBe('/alertas?nivel=urgent')
    expect(safeRedirectPath('https://otro.sitio')).toBe('/')
    expect(safeRedirectPath('//otro.sitio')).toBe('/')
    expect(safeRedirectPath('/\\otro.sitio')).toBe('/')
    expect(safeRedirectPath('/login')).toBe('/')
    expect(safeRedirectPath(null)).toBe('/')
  })

  it('arma la ruta de login', () => {
    expect(loginPath('/')).toBe('/login')
    expect(loginPath('/productos')).toBe('/login?volver=%2Fproductos')
  })
})

describe('toAuthError', () => {
  it('no revela si el usuario existe', () => {
    expect(toAuthError({ code: 'user_not_found' }).message).toBe(toAuthError({ code: 'invalid_credentials' }).message)
  })

  it('traduce límite de intentos y usuario deshabilitado', () => {
    expect(toAuthError({ status: 429 }).message).toMatch(/Demasiados intentos/)
    expect(toAuthError({ code: 'user_banned' }).kind).toBe('permission')
  })

  it('detecta errores de red', () => {
    expect(toAuthError(new TypeError('Failed to fetch')).kind).toBe('network')
  })
})
