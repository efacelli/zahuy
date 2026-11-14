import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/toast-context'
import { ROLE_LABEL } from '../../domain/roles'
import { useAuth } from './auth-context'
import { useProfile } from './useProfile'
import styles from './UserMenu.module.css'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { data: profile } = useProfile()
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
        {profile?.full_name ?? user.email}
        {profile && <span className={styles.role}> · {ROLE_LABEL[profile.role]}</span>}
      </span>
      <Button size="sm" onClick={handleSignOut} loading={busy}>
        Salir
      </Button>
    </div>
  )
}
