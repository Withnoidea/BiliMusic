import { PROJECT_REPOSITORY, PROJECT_URL, RELEASES_URL } from '@/config/project'
import { openDownloadsFolder, getDownloadsFolderPath, friendlyDownloadError } from '@/services/downloadManager'
import { usePlayer } from '@/contexts/PlayerContext'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  FileDown,
  FileUp,
  Download,
  FolderOpen,
  Github,
  Info,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Music2,
  Palette,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  UserRound,
  Captions,
  Lock,
  LockOpen,
} from 'lucide-react'
import { ActionButton, MusicHero, MusicPageShell, MusicSection } from '@/components/AppleMusicPage'
import { useTheme } from '@/hooks/useTheme'
import { useAppSettings } from '@/hooks/useAppSettings'
import { useAuth } from '@/contexts/AuthContext'
import {
  loadDesktopLyricsSettings,
  saveDesktopLyricsSettings,
  type DesktopLyricsSettings,
} from '@/hooks/useDesktopLyrics'
import type { DesktopLyricsStyle } from '@/types/electron.d'
import { createPlaylistsExport, importPlaylistsFromText } from '@/utils/storage'
import { runSync, forceUpload, forceDownload, getLastSync, SYNC_STATE_EVENT, WEBDAV_CONFIGURED_EVENT, type SyncResult } from '@/utils/sync'
import type { AppSettings, SidebarState, ThemeMode } from '@/types'

export default function Settings() {
  const { mode, setMode } = useTheme()
  const { settings, setAppSettings } = useAppSettings()
  const { isLoggedIn, username, avatar, logout, setShowLogin } = useAuth()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [playlistTransferMessage, setPlaylistTransferMessage] = useState('')
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [updateStatus, setUpdateStatus] = useState('')
  const [updateAction, setUpdateAction] = useState<'restart' | 'reload' | null>(null)
  const [dl, setDl] = useState<DesktopLyricsSettings>(() => loadDesktopLyricsSettings())

  useEffect(() => {
    const sync = () => setDl(loadDesktopLyricsSettings())
    window.addEventListener('DESKTOP_LYRICS_CHANGED_EVENT', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('DESKTOP_LYRICS_CHANGED_EVENT', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const updateDl = (patch: { enabled?: boolean; locked?: boolean; style?: Partial<DesktopLyricsStyle> }) => {
    const current = loadDesktopLyricsSettings()
    const next: DesktopLyricsSettings = { ...current, ...patch, style: { ...current.style, ...(patch.style || {}) } }
    setDl(next)
    saveDesktopLyricsSettings(next)
  }

  useEffect(() => {
    window.electronAPI?.getAppVersion?.()?.then((v) => {
      if (v) setAppVersion(v)
    })
    return window.electronAPI?.onUpdaterEvent?.((event) => {
      switch (event.type) {
        case 'checking':
          setUpdateStatus('正在检查更新…'); setUpdateAction(null); break
        case 'unavailable':
          setUpdateStatus(event.message); setUpdateAction(null); break
        case 'up-to-date':
          setUpdateStatus(`已是最新版本（v${event.version}）`); setUpdateAction(null); break
        case 'available':
          setUpdateStatus(`发现新版本 v${event.version}，正在下载…`); setUpdateAction(null); break
        case 'progress':
          setUpdateStatus(`正在下载更新… ${event.percent}%`); break
        case 'downloaded':
          setUpdateStatus(`新版本 v${event.version} 已下载`); setUpdateAction('restart'); break
        case 'manual':
          setUpdateStatus('已打开下载页，请手动下载最新版本'); setUpdateAction(null); break
        case 'renderer-available':
          setUpdateStatus(`发现界面更新 v${event.version}，正在下载…`); setUpdateAction(null); break
        case 'renderer-progress':
          setUpdateStatus(`正在下载界面更新… ${event.percent}%`); break
        case 'renderer-ready-to-apply':
          setUpdateStatus(`界面更新 v${event.version} 已就绪`); setUpdateAction('reload'); break
        case 'error':
          setUpdateStatus(`检查更新失败：${event.message}`); setUpdateAction(null); break
      }
    })
  }, [])

  const checkUpdate = async () => {
    setUpdateStatus('正在检查更新…')
    setUpdateAction(null)
    try {
      if (!window.electronAPI?.checkForUpdate) throw new Error('请在桌面客户端中检查更新')
      await window.electronAPI.checkForUpdate()
    } catch (error) {
      setUpdateStatus(`检查更新失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const runUpdateAction = () => {
    if (updateAction === 'restart') window.electronAPI?.quitAndInstall?.()
    else if (updateAction === 'reload') window.electronAPI?.applyRendererUpdate?.()
  }

  // ===== 云同步（WebDAV）=====
  const [davUrl, setDavUrl] = useState('')
  const [davUser, setDavUser] = useState('')
  const [davPass, setDavPass] = useState('')
  const [davConfigured, setDavConfigured] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const { showToast } = usePlayer()
  const [resolvedDownloadDir, setResolvedDownloadDir] = useState('')
  useEffect(() => { getDownloadsFolderPath().then(setResolvedDownloadDir).catch(() => setResolvedDownloadDir('请重新选择下载目录')) }, [settings.downloadDir])
  const [syncBusy, setSyncBusy] = useState(false)
  const [lastSync, setLastSync] = useState(getLastSync())

  useEffect(() => {
    window.electronAPI?.getWebdavConfig?.().then((c) => {
      if (c?.configured) {
        setDavUrl(c.url)
        setDavUser(c.username)
        setDavConfigured(true)
      }
    })
    const onSyncState = () => setLastSync(getLastSync())
    window.addEventListener(SYNC_STATE_EVENT, onSyncState)
    return () => window.removeEventListener(SYNC_STATE_EVENT, onSyncState)
  }, [])

  const persistWebdav = async (): Promise<boolean> => {
    if (!davUrl.trim() || !davUser.trim()) {
      setSyncMessage('请填写 WebDAV 地址和账号')
      return false
    }
    // 密码留空表示沿用已保存的密码（主进程处理）
    await window.electronAPI?.configureWebdav?.({ url: davUrl.trim(), username: davUser.trim(), password: davPass })
    setDavConfigured(true)
    setDavPass('')
    window.dispatchEvent(new CustomEvent(WEBDAV_CONFIGURED_EVENT)) // 通知 useAutoSync 启用
    return true
  }
  const handleSaveWebdav = async () => {
    if (await persistWebdav()) setSyncMessage('配置已保存')
  }
  const handleTestWebdav = async () => {
    if (!(await persistWebdav())) return
    setSyncMessage('正在测试连接…')
    const r = await window.electronAPI?.testWebdav?.()
    setSyncMessage(r?.message || '测试失败')
  }
  const runSyncTask = async (task: () => Promise<SyncResult>, busyText: string) => {
    if (!davConfigured) {
      setSyncMessage('请先配置并保存 WebDAV')
      return
    }
    setSyncBusy(true)
    setSyncMessage(busyText)
    const r = await task()
    setSyncMessage(r.message)
    setSyncBusy(false)
  }

  const changeDownloadDir = async () => {
    try {
      if (!window.electronAPI?.selectFolder) { showToast('请在桌面客户端中更改下载目录'); return }
      const selected = await window.electronAPI.selectFolder()
      if (selected) { setAppSettings({ downloadDir: selected }); showToast('下载目录已更新，旧音轨仍可在原目录播放') }
    } catch (error) { showToast(friendlyDownloadError(error)) }
  }

  const exportPlaylists = () => {
    const payload = createPlaylistsExport()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bilimusic-playlists-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setPlaylistTransferMessage(`已导出 ${payload.playlists.length} 个歌单`)
  }

  const importPlaylists = async (file?: File) => {
    if (!file) return
    try {
      const result = importPlaylistsFromText(await file.text())
      setPlaylistTransferMessage(`已导入 ${result.imported} 个歌单${result.skipped ? `，跳过 ${result.skipped} 个无效项目` : ''}`)
    } catch (error) {
      setPlaylistTransferMessage(error instanceof Error ? error.message : '导入失败，请检查文件格式')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Preferences"
        title="设置"
        subtitle="整理外观、播放、下载和账号，让每一次打开都保持熟悉的节奏。"
        tone="red"
        action={(
          isLoggedIn ? (
            <ActionButton tone="subtle" onClick={logout}>
              <LogOut size={16} />
              退出登录
            </ActionButton>
          ) : (
            <ActionButton onClick={() => setShowLogin(true)}>
              <LogIn size={16} />
              扫码登录
            </ActionButton>
          )
        )}
      />

      <div className="settings-grid">
        <div className="settings-column">
          <SettingsGroup title="外观" icon={<Palette size={20} />}>
            <SettingsRow label="主题模式">
              <SegmentedControl
                options={[
                  { value: 'light' as ThemeMode, label: '浅色', icon: <Sun size={14} /> },
                  { value: 'dark' as ThemeMode, label: '深色', icon: <Moon size={14} /> },
                  { value: 'system' as ThemeMode, label: '系统', icon: <Monitor size={14} /> },
                ]}
                value={mode}
                onChange={setMode}
              />
            </SettingsRow>
            <SettingsRow label="侧边栏">
              <SegmentedControl
                options={[
                  { value: 'expanded' as SidebarState, label: '展开' },
                  { value: 'collapsed' as SidebarState, label: '折叠' },
                  { value: 'auto' as SidebarState, label: '自动' },
                ]}
                value={settings.sidebarState}
                onChange={(sidebarState) => setAppSettings({ sidebarState })}
              />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="播放" icon={<Music2 size={20} />}>
            <SettingsRow label="音质">
              <StyledSelect
                value={settings.playQuality}
                onChange={(playQuality) => setAppSettings({ playQuality: playQuality as AppSettings['playQuality'] })}
                options={['标准', '高品质', '无损']}
              />
            </SettingsRow>
            <SettingsRow label="自动播放" description="播放结束时自动播放推荐">
              <ToggleSwitch checked={settings.autoPlay} onChange={() => setAppSettings({ autoPlay: !settings.autoPlay })} />
            </SettingsRow>
            <SettingsRow label="歌词显示" description="播放页自动显示歌词">
              <ToggleSwitch checked={settings.showLyrics} onChange={() => setAppSettings({ showLyrics: !settings.showLyrics })} />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="桌面歌词" icon={<Captions size={20} />}>
            <SettingsRow label="启用桌面歌词" description="在桌面悬浮显示实时歌词（类似 QQ 音乐）">
              <ToggleSwitch checked={dl.enabled} onChange={() => updateDl({ enabled: !dl.enabled })} />
            </SettingsRow>
            {dl.enabled && (
              <>
                <SettingsRow
                  label={dl.locked ? '解锁以拖动' : '锁定位置'}
                  description={dl.locked ? '当前鼠标穿透，不挡桌面操作' : '可拖动歌词位置，点击锁定恢复穿透'}
                >
                  <button type="button" className="am-action am-action--subtle" onClick={() => updateDl({ locked: !dl.locked })}>
                    {dl.locked ? <LockOpen size={15} /> : <Lock size={15} />}
                    {dl.locked ? '解锁拖动' : '锁定'}
                  </button>
                </SettingsRow>
                <SettingsRow label="字号">
                  <input
                    type="range"
                    min={18}
                    max={64}
                    value={dl.style.fontSize}
                    onChange={(e) => updateDl({ style: { fontSize: Number(e.target.value) } })}
                    style={{ width: 140 }}
                  />
                  <span style={{ marginLeft: 8, minWidth: 36, textAlign: 'right' }}>{dl.style.fontSize}px</span>
                </SettingsRow>
                <SettingsRow label="颜色">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {['#ff375f', '#ffffff', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => updateDl({ style: { color: c } })}
                        aria-label={c}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: c,
                          border: dl.style.color === c ? '2px solid var(--color-foreground)' : '1px solid rgba(128,128,128,.4)',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                    <input
                      type="color"
                      value={dl.style.color.startsWith('#') ? dl.style.color : '#ff375f'}
                      onChange={(e) => updateDl({ style: { color: e.target.value } })}
                      style={{ width: 28, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
                    />
                  </div>
                </SettingsRow>
                <SettingsRow label="描边" description="深色描边提升浅色背景下的可读性">
                  <ToggleSwitch checked={dl.style.outline} onChange={() => updateDl({ style: { outline: !dl.style.outline } })} />
                </SettingsRow>
                <SettingsRow label="背景条" description="歌词后面加半透明底条">
                  <ToggleSwitch checked={dl.style.showBg} onChange={() => updateDl({ style: { showBg: !dl.style.showBg } })} />
                </SettingsRow>
                <SettingsRow label="加粗">
                  <ToggleSwitch checked={dl.style.bold} onChange={() => updateDl({ style: { bold: !dl.style.bold } })} />
                </SettingsRow>
                <SettingsRow label="预览">
                  <span
                    style={{
                      fontSize: Math.min(dl.style.fontSize, 22),
                      fontWeight: dl.style.bold ? 800 : 600,
                      color: dl.style.color,
                      textShadow: dl.style.outline ? '0 0 2px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.9)' : 'none',
                      background: dl.style.showBg ? dl.style.bgColor : 'transparent',
                      padding: dl.style.showBg ? '2px 10px' : 0,
                      borderRadius: dl.style.showBg ? dl.style.bgRadius : 0,
                    }}
                  >
                    歌词预览 Sample
                  </span>
                </SettingsRow>
              </>
            )}
          </SettingsGroup>

          <SettingsGroup title="歌单迁移" icon={<FileDown size={20} />}>
            <div className="settings-actions settings-actions--stacked">
              <button type="button" onClick={exportPlaylists}>
                <FileDown size={14} />
                导出歌单
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()}>
                <FileUp size={14} />
                导入歌单
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => importPlaylists(e.target.files?.[0])}
              />
              {playlistTransferMessage && <span>{playlistTransferMessage}</span>}
            </div>
          </SettingsGroup>

          <SettingsGroup title="账号" icon={<UserRound size={20} />}>
            <div className="settings-account">
              <div className="settings-account__avatar">
                {isLoggedIn && avatar ? <img src={avatar} alt="" /> : <UserRound size={22} />}
              </div>
              <div className="settings-account__body">
                <span className={isLoggedIn ? 'is-online' : ''}>{isLoggedIn ? '已登录' : '未登录'}</span>
                <strong>{isLoggedIn ? username : 'BiliBili 账号'}</strong>
              </div>
              <button type="button" onClick={isLoggedIn ? logout : () => setShowLogin(true)}>
                {isLoggedIn ? <LogOut size={14} /> : <LogIn size={14} />}
                {isLoggedIn ? '退出' : '登录'}
              </button>
            </div>
          </SettingsGroup>

          <SettingsGroup title="关于" icon={<Info size={20} />}>
            <SettingsRow label="更新来源" description="仅检查此 fork 的正式 Releases；未发布版本时会明确提示，不会从原仓库下载更新。">
              <span>{PROJECT_REPOSITORY}</span>
            </SettingsRow>
            <SettingsRow label="版本">
              <span className="settings-version">BiliMusic v{appVersion}</span>
            </SettingsRow>
            <div className="settings-actions">
              <button type="button" onClick={checkUpdate}>
                <SettingsIcon size={14} />
                检查更新
              </button>
              {updateAction && (
                <button type="button" onClick={runUpdateAction}>
                  <RefreshCw size={14} />
                  {updateAction === 'restart' ? '重启并安装' : '立即重载'}
                </button>
              )}
              <button type="button" onClick={() => window.electronAPI?.openExternal?.(PROJECT_URL)}>
                <Github size={14} />
                关于项目
              </button>
              <button type="button" onClick={() => window.electronAPI?.openExternal?.(RELEASES_URL)}>
                <Download size={14} />
                版本发布页
              </button>
              {updateStatus && <span role="status">{updateStatus}</span>}
            </div>
          </SettingsGroup>
        </div>

        <div className="settings-column">
          <SettingsGroup title="下载" icon={<Download size={20} />}>
            <SettingsRow label="下载目录">
              <div className="settings-path">
                <span title={resolvedDownloadDir}>{resolvedDownloadDir || '默认下载目录'}</span>
                <button
                  type="button"
                  onClick={() => void openDownloadsFolder().catch(error => showToast(friendlyDownloadError(error)))}
                  title="在文件资源管理器中打开"
                >
                  <FolderOpen size={14} />
                  打开目录
                </button>
                <button type="button" onClick={changeDownloadDir} title="更改下载目录">
                  更改
                </button>
              </div>
            </SettingsRow>
            <SettingsRow label="下载格式">
              <StyledSelect
                value={settings.downloadFormat === 'm4a' ? 'M4A (原源格式)' : 'MP3 (推荐，兼容性强)'}
                onChange={(value) => setAppSettings({ downloadFormat: value.startsWith('M4A') ? 'm4a' : 'mp3' })}
                options={['MP3 (推荐，兼容性强)', 'M4A (原源格式)']}
              />
            </SettingsRow>
            <p className="text-caption">MP3 以 320kbps 导出并写入歌名、歌手、专辑及可用封面；有损转码不会提升原音质。M4A 保留原始音频流。</p>
          </SettingsGroup>

          <SettingsGroup title="歌单云同步" icon={<Cloud size={20} />}>
            <SettingsRow label="WebDAV 地址">
              <input
                className="settings-input"
                type="url"
                value={davUrl}
                onChange={(e) => setDavUrl(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/"
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsRow>
            <SettingsRow label="账号">
              <input
                className="settings-input"
                type="text"
                value={davUser}
                onChange={(e) => setDavUser(e.target.value)}
                placeholder="WebDAV 账号"
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsRow>
            <SettingsRow label="密码" description="坚果云等建议使用应用专用密码">
              <input
                className="settings-input"
                type="password"
                value={davPass}
                onChange={(e) => setDavPass(e.target.value)}
                placeholder={davConfigured ? '已保存（修改请重新输入）' : '应用专用密码'}
                autoComplete="off"
              />
            </SettingsRow>
            <div className="settings-actions">
              <button type="button" onClick={handleTestWebdav}>
                <RefreshCw size={14} />
                测试连接
              </button>
              <button type="button" onClick={handleSaveWebdav}>
                保存配置
              </button>
            </div>
            <div className="settings-actions is-divided">
              <button type="button" className="is-primary" onClick={() => runSyncTask(runSync, '正在同步…')} disabled={!davConfigured || syncBusy}>
                <RefreshCw size={14} />
                立即同步
              </button>
              <button type="button" onClick={() => runSyncTask(forceUpload, '正在上传…')} disabled={!davConfigured || syncBusy}>
                <CloudUpload size={14} />
                上传到云端
              </button>
              <button type="button" onClick={() => runSyncTask(forceDownload, '正在下载…')} disabled={!davConfigured || syncBusy}>
                <CloudDownload size={14} />
                从云端下载
              </button>
              {syncMessage && <span>{syncMessage}</span>}
              {lastSync && <span>上次同步：{new Date(lastSync).toLocaleString()}</span>}
            </div>
          </SettingsGroup>
        </div>
      </div>
    </MusicPageShell>
  )
}

function SettingsGroup({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <MusicSection title={title} icon={icon}>
      <div className="settings-panel">{children}</div>
    </MusicSection>
  )
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="settings-segment">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={value === opt.value ? 'is-active' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function StyledSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(option => <option key={option}>{option}</option>)}
    </select>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={onChange}
    >
      <span />
    </button>
  )
}
