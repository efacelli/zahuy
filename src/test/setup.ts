import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// findBy*/waitFor esperan hasta 1 s por defecto. Con la máquina cargada (Docker, el
// servidor de desarrollo, la corrida completa en paralelo) una pantalla con rutas
// diferidas a veces tarda más y la prueba fallaba sin que hubiera un error real.
// Si algo de verdad no aparece, la prueba igual falla, solo que a los 5 s.
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
})
