import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  subtitle?: string
  // Buttons shown on the right.
  children?: ReactNode
}

function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="page-header no-print">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

export default PageHeader
