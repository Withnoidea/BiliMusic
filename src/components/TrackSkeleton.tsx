export default function TrackSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="track-skeletons" role="status" aria-label="正在加载音乐" aria-busy="true">
    {Array.from({ length: rows }, (_, index) => <div className="track-skeleton" key={index} aria-hidden="true"><div className="skeleton track-skeleton__cover" /><div><div className="skeleton track-skeleton__title" /><div className="skeleton track-skeleton__artist" /></div><div className="skeleton track-skeleton__time" /></div>)}
  </div>
}
