// Grey shapes where a page's content will be, shown only the first time it
// loads. Later loads keep the previous content on screen instead.
export function Skeleton({ height = '1rem', width = '100%' }: { height?: string; width?: string }) {
  return <span className="skeleton" style={{ height, width }} aria-hidden="true" />
}

export function PageSkeleton({ tiles = 0 }: { tiles?: number }) {
  return (
    <div className="page-skeleton" role="status" aria-label="Loading">
      {tiles > 0 && (
        <div className="stats">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="card stat">
              <Skeleton width="55%" />
              <Skeleton height="2.2rem" width="40%" />
              <Skeleton width="70%" height="0.8rem" />
            </div>
          ))}
        </div>
      )}
      <div className="card card-body">
        <Skeleton width="30%" height="1.2rem" />
        <Skeleton height="12rem" />
      </div>
      <div className="card card-body">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height="1.1rem" width={`${90 - i * 9}%`} />
        ))}
      </div>
    </div>
  )
}
