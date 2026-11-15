import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import logoMark from '../../assets/brand/zahuy-logo-mark.png'
import { Icon } from '../../components/ui/Icon'
import { UserMenu } from '../../features/auth/UserMenu'
import { BarcodeScanListener } from '../../features/barcode/BarcodeScanListener'
import { NAV_ITEMS } from '../navigation'
import { Sidebar } from './Sidebar'
import styles from './AppLayout.module.css'

const SIDEBAR_ID = 'app-sidebar'

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useLocation()
  const current = NAV_ITEMS.find((item) => (item.path === '/' ? pathname === '/' : pathname.startsWith(item.path)))

  useEffect(() => {
    document.title = current ? `${current.label} · Zahuy` : 'Zahuy · Gestión'
  }, [current])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setSidebarOpen(false)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen])

  return (
    <div className={styles.shell}>
      <BarcodeScanListener />
      <a href="#main" className={styles.skipLink}>
        Saltar al contenido
      </a>
      <Sidebar
        id={SIDEBAR_ID}
        open={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menú"
            aria-controls={SIDEBAR_ID}
            aria-expanded={sidebarOpen}
          >
            <Icon name="menu" />
          </button>
          {/* En celular y tablet el sidebar está oculto: el logo se ve en la barra superior. */}
          <img src={logoMark} alt="" className={styles.topbarLogo} width={73} height={32} />
          <span className={styles.section}>{current?.label ?? 'Zahuy'}</span>
          <UserMenu />
        </header>
        <main id="main" className={styles.content} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
