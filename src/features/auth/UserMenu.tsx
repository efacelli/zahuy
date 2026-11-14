import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast-context'
import { useAuth } from './auth-context'
import styles from './UserMenu.module.css'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  if (!user) return null

  async function handleSignOut() {
    setBusy(true)
    const error = await signOut()
    setBusy(false)
    if (error) toast.error(error.message)
  }

  return (
    <div className={styles.menu}>
      <span className={styles.email} title={user.email}>
        {user.email}
      </span>
      <Button size="sm" onClick={handleSignOut} loading={busy}>
        Salir
      </Button>
    </div>
  )
}
