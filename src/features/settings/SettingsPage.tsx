import { PageHeader } from '../../components/ui/PageHeader'
import { usePermissions } from '../auth/useProfile'
import { AlertSettingsPanel } from './AlertSettingsPanel'
import { UsersPanel } from './UsersPanel'
import styles from './Settings.module.css'

/** Configuración: días de alerta (encargado y dueño) y usuarios (solo dueño). */
export function SettingsPage() {
  const permissions = usePermissions()
  return (
    <>
      <PageHeader
        title="Configuración"
        description={
          permissions.manageUsers ? 'Días de alerta de vencimiento y usuarios del sistema.' : 'Días de alerta de vencimiento.'
        }
      />
      <div className={styles.sections}>
        <AlertSettingsPanel />
        {permissions.manageUsers && <UsersPanel />}
      </div>
    </>
  )
}
