import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// `light` is for dark backgrounds.
export function Logo({ light = false }: { light?: boolean }) {
  const tile = light ? '#fff' : '#1b3a7a'
  const mark = light ? '#1b3a7a' : '#fff'
  return (
    <svg className="logo" viewBox="0 0 36 36" aria-hidden="true">
      <rect width="36" height="36" rx="9" fill={tile} />
      {/* A seed with a stem and two leaves growing from it. */}
      <path d="M18 23v-9" fill="none" stroke={mark} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18 17.5c-4.6 0-7.5-2.8-7.5-7.3 4.7 0 7.5 2.7 7.5 7.3z" fill={mark} />
      <path d="M18 14.5c0-4.4 2.9-7 7.5-7 0 4.4-2.9 7-7.5 7z" fill={mark} />
      <ellipse cx="18" cy="26" rx="5.2" ry="3.6" fill="#e0941a" />
    </svg>
  )
}

export function DashboardIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="12.5" width="7" height="8" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </Icon>
  )
}

export function UsersIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18.5 14.4a5 5 0 0 1 3 4.6v1" />
    </Icon>
  )
}

export function QrIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h2.5v2.5H14zM20.5 14v2.5M14 20.5h2.5M20.5 20.5h-.01" />
    </Icon>
  )
}

export function SignOutIcon() {
  return (
    <Icon>
      <path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5" />
      <path d="M15 8l4 4-4 4M19 12H9.5" />
    </Icon>
  )
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14" />
    </Icon>
  )
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 4.5V11h-6.5" />
    </Icon>
  )
}

export function PrintIcon() {
  return (
    <Icon>
      <path d="M7 9V4h10v5" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="6" rx="1" />
    </Icon>
  )
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function InboxIcon() {
  return (
    <Icon>
      <path d="M4 13l2.5-8h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 13h4.5l1 2h5l1-2H20" />
    </Icon>
  )
}

export function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  )
}

export function EditIcon() {
  return (
    <Icon>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 7.5l3 3" />
    </Icon>
  )
}

export function TrashIcon() {
  return (
    <Icon>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
      <path d="M9 7V4.5h6V7" />
    </Icon>
  )
}
