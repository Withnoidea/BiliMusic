import { lazy, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useAutoSync } from '@/hooks/useAutoSync'
import { useDesktopLyricsBridge } from '@/hooks/useDesktopLyrics'
import { PlayerProvider } from '@/contexts/PlayerContext'
import { NowPlayingProvider } from '@/contexts/NowPlayingContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AddToPlaylistProvider } from '@/contexts/AddToPlaylistContext'
import { ImportProvider } from '@/contexts/ImportContext'
import LoginDialog from '@/components/LoginDialog'
import MainLayout from '@/components/layout/MainLayout'
const Discover = lazy(() => import('@/pages/Discover'))
const SearchPage = lazy(() => import('@/pages/Search'))
const Recommend = lazy(() => import('@/pages/Recommend'))
const Recent = lazy(() => import('@/pages/Recent'))
const Favorites = lazy(() => import('@/pages/Favorites'))
const Playlists = lazy(() => import('@/pages/Playlists'))
const Downloads = lazy(() => import('@/pages/Downloads'))
const Settings = lazy(() => import('@/pages/Settings'))
const Import = lazy(() => import('@/pages/Import'))

function GlobalLoginDialog() {
  const { showLogin, setShowLogin, checkLogin } = useAuth()
  if (!showLogin) return null
  return (
    <LoginDialog
      onClose={() => setShowLogin(false)}
      onSuccess={() => {
        setShowLogin(false)
        checkLogin()
      }}
    />
  )
}

function DesktopLyricsBridge() {
  useDesktopLyricsBridge()
  return null
}

export default function App() {
  // 渲染层成功挂载后回报主进程：确认当前（可能是 OTA 热补丁的）渲染包可用，避免下次启动误回滚
  useEffect(() => {
    window.electronAPI?.notifyRendererReady?.()
  }, [])

  // 云同步自动触发（启动 + 改动防抖 + 周期）
  useAutoSync()

  return (
    <AuthProvider>
      <PlayerProvider>
        <NowPlayingProvider>
          <AddToPlaylistProvider>
            <ImportProvider>
              <DesktopLyricsBridge />
              <Routes>
                <Route element={<MainLayout />}>
                  <Route path="/" element={<Discover />} />
                  <Route path="/discover" element={<Discover />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/recommend" element={<Recommend />} />
                  <Route path="/recent" element={<Recent />} />
                  <Route path="/favorites" element={<Favorites />} />
                  <Route path="/playlists" element={<Playlists />} />
                  <Route path="/playlists/:playlistId" element={<Playlists />} />
                  <Route path="/import" element={<Import />} />
                  <Route path="/downloads" element={<Downloads />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
              </Routes>
              <GlobalLoginDialog />
            </ImportProvider>
          </AddToPlaylistProvider>
        </NowPlayingProvider>
      </PlayerProvider>
    </AuthProvider>
  )
}
