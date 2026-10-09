import { Suspense } from 'react'
import TrackSkeleton from '@/components/TrackSkeleton'
import { Outlet } from 'react-router-dom'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import PlayerBar from './PlayerBar'
import NowPlaying from '@/components/NowPlaying'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function MainLayout() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
      }}
    >
      <TitleBar />

      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <Sidebar />

        <main
          className="app-content"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'var(--color-background)',
            padding: 'var(--space-lg) var(--space-xl)',
          }}
        >
          <ErrorBoundary>
            <Suspense fallback={<TrackSkeleton />}><Outlet /></Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <PlayerBar />

      <NowPlaying />
    </div>
  )
}