import { useCallback, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle, ArrowDownToLine, Check, ChevronDown, Loader2, Music, Pause, Play, RotateCw, Search, Square, X,
} from 'lucide-react'
import { MusicPageShell, MusicHero, MusicSection, EmptyLibrary, formatCount } from '@/components/AppleMusicPage'
import { useImport, deriveCounts } from '@/contexts/ImportContext'
import { searchManualCandidates, type MatchCandidate, type MatchConfidence } from '@/services/playlistMatch'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  exact: '同曲 · 原版',
  cover: '同曲 · 翻唱',
  remix: '同曲 · 混音',
  live: '同曲 · 现场',
  weak: '待确认',
  none: '不匹配',
}

const CONFIDENCE_COLOR: Record<MatchConfidence, string> = {
  exact: 'var(--color-green, #30d158)',
  cover: 'var(--color-primary, #ff375f)',
  remix: 'var(--color-primary, #ff375f)',
  live: 'var(--color-primary, #ff375f)',
  weak: 'var(--color-muted-foreground)',
  none: 'var(--color-muted-foreground)',
}

const INPUT_STYLE = {
  flex: 1,
  height: 44,
  padding: '0 16px',
  borderRadius: 10,
  border: '1px solid var(--sidebar-control-border, rgba(255,255,255,0.12))',
  background: 'var(--sidebar-search-bg, rgba(255,255,255,0.06))',
  color: 'var(--color-foreground)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
} as const

const MANUAL_BTN_STYLE = {
  height: 28,
  padding: '0 10px',
  borderRadius: 7,
  border: '1px solid var(--sidebar-control-border, rgba(255,255,255,0.12))',
  background: 'transparent',
  color: 'var(--color-primary, #ff375f)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
} as const

export default function Import() {
  const navigate = useNavigate()
  const { isLoggedIn, setShowLogin } = useAuth()
  const { session, error, startImport, pause, resume, cancel, retryPending, selectCandidate, clearSession } = useImport()
  const [url, setUrl] = useState('')
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null)
  const [manual, setManual] = useState<{ index: number; query: string; loading: boolean; candidates: MatchCandidate[]; manualError: string } | null>(null)

  const { status, playlist, results, selected, progress, targetPlaylistId } = session
  const counts = deriveCounts(results, selected)
  // 尚未完成 = 未处理(null) / 失败(error) / 待确认、未找到（无已选结果）
  const incompleteCount = results.reduce((n, r, i) => {
    if (!r || r.error) return n + 1
    return (selected[i] ?? r.bestMatch?.bvid) ? n : n + 1
  }, 0)

  // 空闲或上一个导入已完成时都可直接导入新歌单（旧歌单进度已按歌单保存，可在其页面续导）
  const canStart = status === 'idle' || status === 'done'
  const handleStart = useCallback(() => {
    if (!url.trim() || !canStart) return
    setManual(null)
    setExpandedTrack(null)
    startImport(url.trim())
  }, [url, canStart, startImport])

  const handleViewPlaylist = useCallback(() => {
    if (targetPlaylistId) navigate(`/playlists/${targetPlaylistId}`)
  }, [targetPlaylistId, navigate])

  const handleDiscard = useCallback(() => {
    setManual(null)
    clearSession()
  }, [clearSession])

  // ===== 手动查找保底 =====
  const openManualSearch = (index: number, trackName: string, trackArtist: string) => {
    setManual({ index, query: `${trackName} ${trackArtist.split(/[\/&,，]/)[0] || ''}`.trim(), loading: false, candidates: [], manualError: '' })
  }
  const closeManualSearch = () => setManual(null)

  const runManualSearch = async () => {
    if (!manual || !manual.query.trim() || manual.loading) return
    const track = results[manual.index]
    const name = track?.query.name ?? playlist?.tracks[manual.index]?.name ?? ''
    const artist = track?.query.artist ?? playlist?.tracks[manual.index]?.artist ?? ''
    const duration = playlist?.tracks[manual.index]?.duration
    setManual((m) => (m ? { ...m, loading: true, manualError: '', candidates: [] } : m))
    try {
      const candidates = await searchManualCandidates(manual.query.trim(), name, artist, duration)
      setManual((m) => (m ? { ...m, loading: false, candidates } : m))
    } catch (e) {
      setManual((m) => (m ? { ...m, loading: false, manualError: e instanceof Error ? e.message : '搜索失败' } : m))
    }
  }

  const handleManualSelect = (cand: MatchCandidate) => {
    if (!manual) return
    selectCandidate(manual.index, cand)
    setManual(null)
  }

  return (
    <MusicPageShell>
      <MusicHero
        eyebrow="Import"
        title="外部歌单导入"
        subtitle="粘贴网易云或QQ音乐歌单链接，自动匹配B站对应音乐"
        tone="purple"
      />

      <MusicSection title="歌单链接" icon={<ArrowDownToLine size={22} />}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim() && canStart) handleStart() }}
            placeholder="粘贴网易云或QQ音乐歌单链接…"
            disabled={!canStart}
            style={INPUT_STYLE}
          />
          <motion.button
            type="button"
            onClick={handleStart}
            disabled={!url.trim() || !canStart}
            whileHover={{ y: -1, scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            style={{
              height: 44,
              padding: '0 24px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--color-primary, #ff375f)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: url.trim() && canStart ? 'pointer' : 'not-allowed',
              opacity: url.trim() && canStart ? 1 : 0.5,
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Search size={16} />
            导入并匹配
          </motion.button>
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 10, background: 'rgba(255,69,58,0.12)', color: '#ff453a', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-muted-foreground)' }}>
          支持：music.163.com/playlist?id=xxx · y.qq.com/n/ryqq/playlist/xxx · QQ音乐分享链接（c6.y.qq.com/base/fcgi-bin/u?__=…）
        </div>

        {!isLoggedIn && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-orange, #ff9f0a)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={13} />
            <span>
              未登录 B站，导入大歌单更容易触发风控（-352）。建议先{' '}
              <span onClick={() => setShowLogin(true)} style={{ color: 'var(--color-primary, #ff375f)', cursor: 'pointer', textDecoration: 'underline' }}>登录</span>
              {' '}再导入。
            </span>
          </div>
        )}
      </MusicSection>

      {status === 'fetching' && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-muted)' }}>
          <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: 16, fontSize: 15 }}>正在获取歌单信息…</p>
        </div>
      )}

      {(status === 'matching' || status === 'paused') && playlist && (
        <MusicSection
          title={status === 'paused' ? '已暂停' : '匹配中'}
          icon={status === 'paused' ? <Pause size={22} /> : <Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} />}
        >
          <div style={{ padding: '20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {playlist.name} · {playlist.tracks.length} 首
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton onClick={handleViewPlaylist}><Music size={14} /> 查看歌单</ActionButton>
                {status === 'matching' ? (
                  <ActionButton onClick={pause}><Pause size={14} /> 暂停</ActionButton>
                ) : (
                  <ActionButton onClick={resume} primary><Play size={14} /> 继续</ActionButton>
                )}
                <ActionButton onClick={cancel} danger><Square size={13} /> 停止</ActionButton>
              </div>
            </div>
            {progress && (
              <>
                <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 6 }}>
                  {status === 'paused'
                    ? `已暂停（已处理 ${counts.done}/${playlist.tracks.length}），点「继续」从断点接着匹配`
                    : progress.phase === 'cooldown'
                    ? `被 B站风控拦截，冷却 ${Math.round((progress.cooldownMs ?? 0) / 1000)}s 后自动继续…`
                    : progress.phase === 'retrying'
                    ? `重试中 ${progress.current}/${progress.total} — ${progress.trackName}`
                    : `正在匹配 ${progress.current}/${progress.total} — ${progress.trackName}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginBottom: 12 }}>
                  已匹配 {counts.matched} · 待确认 {counts.pending} · 未找到 {counts.notFound} · 失败/限流 {counts.failed}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <motion.div
                    animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                    style={{ height: '100%', background: progress.phase === 'cooldown' || status === 'paused' ? 'var(--color-muted-foreground)' : 'var(--color-primary, #ff375f)', borderRadius: 2 }}
                  />
                </div>
              </>
            )}
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--color-muted-foreground)' }}>
              已匹配的曲目会即时写入歌单，你可以切到其他页面边听边等，导入在后台继续。
            </div>
          </div>
        </MusicSection>
      )}

      {status === 'done' && playlist && (
        <>
          <MusicSection title="匹配结果" icon={<Check size={22} />}>
            <div style={{ display: 'flex', gap: 28, marginBottom: 20, padding: '16px 0', borderBottom: '1px solid var(--sidebar-border, rgba(255,255,255,0.08))', flexWrap: 'wrap' }}>
              <StatItem num={counts.matched} label="已匹配" color="var(--color-green, #30d158)" />
              <StatItem num={counts.pending} label="待确认" color="var(--color-primary, #ff375f)" />
              <StatItem num={counts.notFound} label="未找到" color="var(--color-muted-foreground)" />
              <StatItem num={counts.failed} label="失败/限流" color="var(--color-orange, #ff9f0a)" />
              <StatItem num={playlist.tracks.length} label="总曲目" />
            </div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <motion.button
                type="button"
                onClick={handleViewPlaylist}
                whileHover={{ y: -1, scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                style={{
                  height: 44,
                  padding: '0 28px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--color-primary, #ff375f)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Music size={16} /> 查看歌单（{counts.matched} 首已写入）
              </motion.button>
              {incompleteCount > 0 && (
                <motion.button
                  type="button"
                  onClick={() => retryPending()}
                  whileHover={{ y: -1, scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  style={{
                    height: 44,
                    padding: '0 22px',
                    borderRadius: 10,
                    border: '1px solid var(--sidebar-control-border, rgba(255,255,255,0.12))',
                    background: 'transparent',
                    color: 'var(--color-foreground)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <RotateCw size={16} /> 继续导入 {incompleteCount} 首
                </motion.button>
              )}
              <motion.button
                type="button"
                onClick={handleDiscard}
                whileTap={{ scale: 0.96 }}
                style={{
                  height: 44,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <X size={15} /> 放弃本次导入
              </motion.button>
            </div>
            {incompleteCount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>
                有 {incompleteCount} 首尚未匹配完成，可稍后回来点「继续导入」补齐，已匹配的曲目会继续累积到歌单。
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--color-muted-foreground)', marginTop: 4 }}>
              进度已保存到该歌单，其页面右上角可随时「继续导入」；也可直接在上方粘贴新链接导入另一个歌单。
            </div>
          </MusicSection>

          {manual && (results[manual.index] || playlist.tracks[manual.index]) && (
            <MusicSection title="手动匹配" icon={<Search size={22} />}>
              <div style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 12 }}>
                为「{results[manual.index]?.query.name ?? playlist.tracks[manual.index]?.name} · {results[manual.index]?.query.artist ?? playlist.tracks[manual.index]?.artist}」手动挑选B站视频，点选即可作为匹配结果
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <input
                  type="text"
                  value={manual.query}
                  onChange={(e) => setManual((m) => (m ? { ...m, query: e.target.value } : m))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !manual.loading) runManualSearch() }}
                  placeholder="输入关键词搜索B站…"
                  style={{ ...INPUT_STYLE, height: 40, borderRadius: 8, fontSize: 13 }}
                />
                <motion.button
                  type="button"
                  onClick={runManualSearch}
                  disabled={!manual.query.trim() || manual.loading}
                  whileTap={{ scale: 0.96 }}
                  style={{
                    height: 40,
                    padding: '0 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: 'var(--color-primary, #ff375f)',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: manual.query.trim() && !manual.loading ? 'pointer' : 'not-allowed',
                    opacity: manual.query.trim() && !manual.loading ? 1 : 0.5,
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {manual.loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
                  搜索
                </motion.button>
                <button
                  type="button"
                  onClick={closeManualSearch}
                  style={{
                    height: 40,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: '1px solid var(--sidebar-control-border, rgba(255,255,255,0.12))',
                    background: 'transparent',
                    color: 'var(--color-muted)',
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <X size={14} /> 关闭
                </button>
              </div>
              {manual.manualError && (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,69,58,0.12)', color: '#ff453a', fontSize: 12 }}>
                  {manual.manualError}
                </div>
              )}
              {manual.loading && (
                <div style={{ fontSize: 13, color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0' }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> 搜索中…
                </div>
              )}
              {!manual.loading && manual.candidates.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {manual.candidates.map((cand) => (
                    <CandidateRow
                      key={cand.bvid}
                      candidate={cand}
                      selected={(selected[manual.index] ?? results[manual.index]?.bestMatch?.bvid) === cand.bvid}
                      onSelect={() => handleManualSelect(cand)}
                    />
                  ))}
                </div>
              )}
              {!manual.loading && manual.candidates.length === 0 && manual.query && !manual.manualError && (
                <div style={{ fontSize: 13, color: 'var(--color-muted-foreground)', padding: '12px 0' }}>
                  没有搜索结果，试试换个关键词。
                </div>
              )}
            </MusicSection>
          )}

          <MusicSection title="曲目详情" icon={<Music size={22} />}>
            {results.map((result, i) => {
              if (result) {
                return (
                  <MatchEntry
                    key={i}
                    index={i}
                    trackName={result.query.name}
                    trackArtist={result.query.artist}
                    candidates={result.candidates}
                    selectedBvid={selected[i] ?? result.bestMatch?.bvid}
                    onSelect={(cand) => selectCandidate(i, cand)}
                    expanded={expandedTrack === i}
                    onToggle={() => setExpandedTrack(expandedTrack === i ? null : i)}
                    hasError={!!result.error}
                    onManualSearch={() => openManualSearch(i, result.query.name, result.query.artist)}
                  />
                )
              }
              return (
                <PendingEntry
                  key={i}
                  index={i}
                  trackName={playlist.tracks[i]?.name ?? ''}
                  trackArtist={playlist.tracks[i]?.artist ?? ''}
                  onManualSearch={() => openManualSearch(i, playlist.tracks[i]?.name ?? '', playlist.tracks[i]?.artist ?? '')}
                />
              )
            })}
          </MusicSection>
        </>
      )}

      {status === 'idle' && !error && (
        <EmptyLibrary
          icon={<ArrowDownToLine size={40} />}
          title="粘贴链接开始导入"
          subtitle="将网易云或QQ音乐的歌单链接粘贴到上方输入框，系统会自动匹配B站对应音乐资源"
        />
      )}
    </MusicPageShell>
  )
}

function ActionButton({ children, onClick, primary, danger }: { children: ReactNode; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 32,
        padding: '0 12px',
        borderRadius: 8,
        border: primary ? 'none' : '1px solid var(--sidebar-control-border, rgba(255,255,255,0.12))',
        background: primary ? 'var(--color-primary, #ff375f)' : 'transparent',
        color: danger ? 'var(--color-orange, #ff9f0a)' : primary ? '#fff' : 'var(--color-muted)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      {children}
    </button>
  )
}

function StatItem({ num, label, color }: { num: number; label: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 600, color: color || 'var(--color-foreground)' }}>{num}</div>
      <div style={{ fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 2, letterSpacing: '0.05em' }}>{label}</div>
    </div>
  )
}

function MatchEntry({
  index,
  trackName,
  trackArtist,
  candidates,
  selectedBvid,
  onSelect,
  expanded,
  onToggle,
  hasError,
  onManualSearch,
}: {
  index: number
  trackName: string
  trackArtist: string
  candidates: MatchCandidate[]
  selectedBvid?: string
  onSelect: (cand: MatchCandidate) => void
  expanded: boolean
  onToggle: () => void
  hasError?: boolean
  onManualSearch?: () => void
}) {
  const selected = candidates.find(c => c.bvid === selectedBvid)
  const hasCandidates = candidates.length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      style={{ borderTop: '1px solid var(--sidebar-border, rgba(255,255,255,0.06))', padding: '16px 0' }}
    >
      <div
        onClick={hasCandidates ? onToggle : undefined}
        style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 12, cursor: hasCandidates ? 'pointer' : 'default' }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trackName}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
            {trackArtist}
            {selected && (
              <span style={{ marginLeft: 8, color: CONFIDENCE_COLOR[selected.confidence] }}>
                · {CONFIDENCE_LABEL[selected.confidence]} · {selected.uploader}
              </span>
            )}
            {hasError && (
              <span style={{ marginLeft: 8, color: 'var(--color-orange, #ff9f0a)' }}>· 失败/限流</span>
            )}
            {!hasCandidates && !hasError && (
              <span style={{ marginLeft: 8, color: 'var(--color-muted-foreground)' }}>· 未找到匹配</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {selected && <span style={{ fontSize: 13, fontWeight: 600, color: CONFIDENCE_COLOR[selected.confidence] }}>{selected.score}</span>}
          {!selectedBvid && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onManualSearch?.() }}
              style={MANUAL_BTN_STYLE}
            >
              <Search size={12} /> 手动查找
            </button>
          )}
          {hasCandidates && (
            <ChevronDown size={16} style={{ color: 'var(--color-muted-foreground)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && hasCandidates && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingLeft: 40, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {candidates.map((cand) => (
                <CandidateRow
                  key={cand.bvid}
                  candidate={cand}
                  selected={cand.bvid === selectedBvid}
                  onSelect={() => onSelect(cand)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function PendingEntry({ index, trackName, trackArtist, onManualSearch }: {
  index: number
  trackName: string
  trackArtist: string
  onManualSearch: () => void
}) {
  return (
    <div style={{ borderTop: '1px solid var(--sidebar-border, rgba(255,255,255,0.06))', padding: '16px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trackName}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 2 }}>
            {trackArtist}
            <span style={{ marginLeft: 8, color: 'var(--color-muted-foreground)' }}>· 未处理</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onManualSearch}
          style={MANUAL_BTN_STYLE}
        >
          <Search size={12} /> 手动查找
        </button>
      </div>
    </div>
  )
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: MatchCandidate
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '8px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        background: selected ? 'rgba(255,55,95,0.10)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 6, overflow: 'hidden',
        background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {candidate.coverUrl ? (
          <img src={candidate.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
        ) : (
          <Music size={16} color="var(--color-muted-foreground)" />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {candidate.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
          {candidate.uploader} · {formatCount(candidate.playCount)}播放 · {candidate.duration} · {candidate.reason}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: CONFIDENCE_COLOR[candidate.confidence], whiteSpace: 'nowrap' }}>
          {CONFIDENCE_LABEL[candidate.confidence]}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: CONFIDENCE_COLOR[candidate.confidence] }}>
          {candidate.score}
        </span>
        {selected && <Check size={16} color="var(--color-primary, #ff375f)" />}
      </div>
    </div>
  )
}
