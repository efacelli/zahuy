import { PageHeader } from '../../components/ui/PageHeader'
import { usePermissions } from '../auth/useProfile'
import { AlertSettingsPanel } from './AlertSettingsPanel'
import { SalesSettingsPanel } from './SalesSettingsPanel'
import { UsersPanel } from './UsersPanel'
import styles from './Settings.module.css'

/** Configuración: días de alerta y ventas (encargado y dueño) y usuarios (solo dueño). */
export function SettingsPage() {
  const permissions = usePermissions()
  return (
    <>
      <PageHeader
        title="Configuración"
        description={
          permissions.manageUsers
            ? 'Días de alerta de vencimiento, ventas y ticket, y usuarios del sistema.'
            : 'Días de alerta de vencimiento, ventas y ticket.'
        }
      />
      <div className={styles.sections}>
        <AlertSettingsPanel />
        <SalesSettingsPanel />
        {permissions.manageUsers && <UsersPanel />}
      </div>
    </>
  )
}
