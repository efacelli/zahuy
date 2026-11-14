import { NavLink } from 'react-router'
import logoMark from '../../assets/brand/zahuy-logo-mark.png'
import { Icon } from '../../components/ui/Icon'
import { NAV_ITEMS } from '../navigation'
import styles from './Sidebar.module.css'

interface SidebarProps {
  id: string
  open: boolean
  onNavigate: () => void
  onClose: () => void
}

export function Sidebar({ id, open, onNavigate, onClose }: SidebarProps) {
  return (
    <aside id={id} className={`${styles.sidebar} ${open ? styles.open : ''}`} aria-label="Menú principal">
      <div className={styles.brand}>
        <img src={logoMark} alt="Zahuy Autoservicio" className={styles.logo} width={340} height={149} />
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Cerrar menú">
          <Icon name="close" />
        </button>
      </div>
      <nav>
        <ul className={styles.list}>
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                onClick={onNavigate}
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
