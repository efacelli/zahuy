import styles from './ConfigErrorScreen.module.css'

/** Se muestra si falta configurar Supabase o si la clave no es la pública. */
export function ConfigErrorScreen({ problems }: { problems: string[] }) {
  return (
    <main className={styles.screen}>
      <div className={styles.card} role="alert">
        <h1>La aplicación no está configurada</h1>
        <ul>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p>
          Copiá <code>.env.example</code> como <code>.env.local</code>, completá los datos del proyecto Supabase y
          reiniciá el servidor de desarrollo.
        </p>
      </div>
    </main>
  )
}
