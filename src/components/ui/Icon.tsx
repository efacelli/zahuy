import type { SVGProps } from 'react'

const PATHS = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  products:
    'M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7ZM12 12 3.5 7M12 12l8.5-5M12 12v8.7',
  movements: 'M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3',
  alerts: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20a2 2 0 0 0 4 0',
  catalogs: 'M4 5h7l9 9-6 6-9-9V5Zm4 4h.01',
  settings: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  sortAsc: 'M8 15l4-4 4 4',
  sortDesc: 'M8 10l4 4 4-4',
  sortNone: 'M8 10l4-4 4 4M8 14l4 4 4-4',
  check: 'M5 12.5 10 17l9-10',
  warning: 'M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01',
  error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v5m0 3h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v5m0-8h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z',
} as const

export type IconName = keyof typeof PATHS

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  /** Si el ícono transmite información por sí solo, describirlo acá. */
  label?: string
}

export function Icon({ name, size = 20, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
