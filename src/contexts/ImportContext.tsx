/**
 * 导入会话全局上下文
 *
 * 把歌单导入从"页面内一次性流程"提升为"全局后台任务 + 增量写入 + 可暂停/续导"：
 *  - 会话存于 localStorage，切页不丢、重启可续；
 *  - 匹配在后台逐首进行，每完成一首（onResult）立即把 bestMatch 写入目标歌单，
 *    因此"部分成功即生效"，导入过程中即可打开歌单边导入边听；
 *  - 支持 暂停/继续（pause 钩子）、停止（保留已匹配部分）、继续导入未完成项。
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { fetchExternalPlaylist, type ExternalPlaylist } from '@/services/playlistImport'
import {
  matchPlaylist,
  type MatchCandidate,
  type MatchResult,
  type PlaylistMatchProgress,
} from '@/services/playlistMatch'
import { addTrackToPlaylist, createPlaylist, removeTracksFromPlaylist } from '@/utils/storage'

const SESSION_KEY = 'bilimusic_import_session'

export type ImportStatus = 'idle' | 'fetching' | 'matching' | 'paused' | 'done'

export interface ImportSession {
  status: ImportStatus
  playlist: ExternalPlaylist | null
  /** 与 playlist.tracks 一一对应；null = 尚未处理 */
  results: (MatchResult | null)[]
  selected: Record<number, string>
  progress: PlaylistMatchProgress | null
  /** 匹配开始前就创建的目标歌单 id，匹配过程增量写入 */
  targetPlaylistId: string | null
  startedAt: number
}

export interface ImportCounts {
  done: number
  matched: number
  pending: number
  notFound: number
  failed: number
}

export function deriveCounts(results: (MatchResult | null)[], selected: Record<number, string>): ImportCounts {
  let done = 0, matched = 0, pending = 0, notFound = 0, failed = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (!r) continue
    done++
    if (r.error) failed++
    else if (r.candidates.length === 0) notFound++
    else if (selected[i] ?? r.bestMatch?.bvid) matched++
    else pending++
  }
  return { done, matched, pending, notFound, failed }
}

function emptySession(): ImportSession {
  return { status: 'idle', playlist: null, results: [], selected: {}, progress: null, targetPlaylistId: null, startedAt: 0 }
}

function loadSession(): ImportSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as ImportSession
    if (!s || !Array.isArray(s.results)) return null
    // 应用重启后匹配循环已死：matching/paused 一律降级为 done，保留已完成部分供"继续导入"
    if (s.status === 'matching' || s.status === 'paused') s.status = 'done'
    return s
  } catch {
    return null
  }
}

// 落盘时裁剪候选列表（内存态保持完整），控制 localStorage 体积与序列化开销
function saveSession(s: ImportSession) {
  try {
    const slim: ImportSession = {
      ...s,
      results: s.results.map((r) => (r ? { ...r, candidates: r.candidates.slice(0, 8) } : null)),
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(slim))
  } catch {
    // 超配额/不可用：保持内存态即可（导入仍正常，只是重启后无法续导）
  }
}

// ===== 按歌单保存的导入记录 =====
// 每个导入目标歌单一份（含完整源曲目与匹配结果），独立于当前导入页会话持久化，
// 这样换另一个歌单导入后，之前的歌单仍可在其页面右上角"继续导入"。
const RECORDS_KEY = 'bilimusic_import_records'

export interface PlaylistImportRecord {
  playlist: ExternalPlaylist
  results: (MatchResult | null)[]
  selected: Record<number, string>
  targetPlaylistId: string
  updatedAt: number
}

function loadRecords(): Record<string, PlaylistImportRecord> {
  try {
    const raw = localStorage.getItem(RECORDS_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function saveRecords(records: Record<string, PlaylistImportRecord>) {
  try {
    const slim = Object.fromEntries(
      Object.entries(records).map(([id, rec]) => [
        id,
        { ...rec, results: rec.results.map((r) => (r ? { ...r, candidates: r.candidates.slice(0, 8) } : null)) },
      ]),
    )
    localStorage.setItem(RECORDS_KEY, JSON.stringify(slim))
  } catch {
    // 超配额：忽略（仅影响重启后的"继续导入"，不影响导入本身）
  }
}

interface ImportContextValue {
  session: ImportSession
  records: Record<string, PlaylistImportRecord>
  error: string
  startImport: (url: string) => Promise<void>
  pause: () => void
  resume: () => void
  cancel: () => void
  retryPending: () => Promise<void>
  resumePlaylist: (playlistId: string) => Promise<void>
  selectCandidate: (index: number, cand: MatchCandidate) => void
  clearSession: () => void
}

const ImportContext = createContext<ImportContextValue | null>(null)

export function ImportProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ImportSession>(() => loadSession() ?? emptySession())
  const [error, setError] = useState('')
  const [records, setRecords] = useState<Record<string, PlaylistImportRecord>>(() => {
    const r = loadRecords()
    // 启动时把当前活跃会话也并入记录，避免随后新导入替换会话导致旧歌单无法续导
    const s = loadSession()
    if (s?.targetPlaylistId && s.playlist && !r[s.targetPlaylistId]) {
      r[s.targetPlaylistId] = {
        playlist: s.playlist,
        results: s.results,
        selected: s.selected,
        targetPlaylistId: s.targetPlaylistId,
        updatedAt: s.startedAt,
      }
    }
    return r
  })
  const sessionRef = useRef(session)
  const recordsRef = useRef(records)
  const abortRef = useRef<AbortController | null>(null)
  const pausedRef = useRef(false)
  const resumeRef = useRef<() => void>(() => {})
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runningRef = useRef(false)

  // 按歌单保存导入记录（resting 状态：完成/取消/被替换），供歌单页右上角"继续导入"
  const writeRecord = useCallback((s: ImportSession) => {
    if (!s.targetPlaylistId || !s.playlist) return
    const rec: PlaylistImportRecord = {
      playlist: s.playlist,
      results: s.results,
      selected: s.selected,
      targetPlaylistId: s.targetPlaylistId,
      updatedAt: Date.now(),
    }
    const next = { ...recordsRef.current, [s.targetPlaylistId]: rec }
    recordsRef.current = next
    setRecords(next)
    if (recordTimerRef.current) clearTimeout(recordTimerRef.current)
    recordTimerRef.current = setTimeout(() => saveRecords(recordsRef.current), 300)
  }, [])

  // 提交新会话：同步更新 ref（供后台循环读取最新值）+ 触发 React 重渲染 + 防抖落盘
  const commit = useCallback((next: ImportSession) => {
    sessionRef.current = next
    setSession(next)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveSession(sessionRef.current), 500)
    // resting 状态落盘到按歌单记录，歌单页可随时续导
    if (next.status === 'done' && next.targetPlaylistId && next.playlist) {
      writeRecord(next)
    }
  }, [writeRecord])

  // 卸载兜底落盘
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveSession(sessionRef.current)
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current)
      saveRecords(recordsRef.current)
    }
  }, [])

  // 暂停钩子：置位时返回一个"恢复才 resolve"的 promise，并响应 abort
  const pauseWait = useCallback((signal?: AbortSignal): Promise<void> | null => {
    if (!pausedRef.current) return null
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
      resumeRef.current = () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
    })
  }, [])

  const parseDuration = (durationStr: string): number => {
    if (!durationStr) return 0
    const parts = durationStr.split(':')
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    return 0
  }

  const writeResultToPlaylist = useCallback((playlistId: string, query: { name: string; artist: string }, cand: MatchCandidate) => {
    const track = {
      id: cand.bvid,
      title: query.name,
      artist: query.artist,
      coverUrl: cand.coverUrl,
      duration: parseDuration(cand.duration),
      videoUrl: '',
      bvid: cand.bvid,
      playCount: cand.playCount,
      isLiked: false,
    }
    addTrackToPlaylist(playlistId, track)
  }, [])

  // 匹配循环：只处理未完成（null 或上一轮失败）的下标；逐首 onResult 写结果 + 增量写歌单
  const runMatching = useCallback(async (ext: ExternalPlaylist, baseResults: (MatchResult | null)[]) => {
    if (runningRef.current) return
    runningRef.current = true
    pausedRef.current = false
    const total = ext.tracks.length
    // 未完成 = 无已选结果：未处理(null) / 失败(error) / 待确认、未找到(有或无候选但没选出)
    const sel = sessionRef.current.selected
    const pendingIdx: number[] = []
    baseResults.forEach((r, i) => {
      if (!r || r.error || !(sel[i] ?? r.bestMatch?.bvid)) pendingIdx.push(i)
    })

    const controller = new AbortController()
    abortRef.current = controller
    try {
      if (pendingIdx.length === 0) {
        const s = sessionRef.current
        const c = deriveCounts(s.results, s.selected)
        commit({ ...s, status: 'done', progress: { current: c.done, total, trackName: '', matched: c.matched, notFound: c.notFound, failed: c.failed, phase: 'searching' } })
        return
      }
      const pendingTracks = pendingIdx.map((i) => ext.tracks[i])

      await matchPlaylist(
        pendingTracks,
        (p) => {
          const s = sessionRef.current
          const c = deriveCounts(s.results, s.selected)
          commit({
            ...s,
            progress: {
              ...p,
              // 进度条位置换算到整单下标
              current: pendingIdx[Math.min(p.current - 1, pendingIdx.length - 1)] + 1,
              total,
              matched: c.matched,
              notFound: c.notFound,
              failed: c.failed,
            },
          })
        },
        {
          signal: controller.signal,
          pause: pauseWait,
          onResult: (k, result) => {
            const idx = pendingIdx[k]
            const s = sessionRef.current
            const nextResults = [...s.results]
            nextResults[idx] = result
            // 增量写入：自动匹配到 bestMatch 的立即写入目标歌单（部分成功即生效）
            if (s.targetPlaylistId && result.bestMatch) {
              writeResultToPlaylist(s.targetPlaylistId, result.query, result.bestMatch)
            }
            const c = deriveCounts(nextResults, s.selected)
            commit({
              ...s,
              results: nextResults,
              progress: { current: idx + 1, total, trackName: result.query.name, matched: c.matched, notFound: c.notFound, failed: c.failed, phase: 'searching' },
            })
          },
        },
      )
    } catch {
      // aborted 等情况：保留已完成部分
    } finally {
      runningRef.current = false
      abortRef.current = null
      pausedRef.current = false
      const s = sessionRef.current
      const c = deriveCounts(s.results, s.selected)
      const remaining = s.results.length - c.done
      // 已全部处理完（含在最后一首在途时点了暂停）→ 归为 done；
      // 仍有剩余且正处于暂停 → 保持暂停，待用户「继续」续跑
      if (remaining === 0 || s.status !== 'paused') {
        commit({ ...s, status: 'done', progress: { current: c.done, total, trackName: '', matched: c.matched, notFound: c.notFound, failed: c.failed, phase: 'searching' } })
      }
    }
  }, [commit, pauseWait, writeResultToPlaylist])

  const startImport = useCallback(async (url: string) => {
    setError('')
    // 替换会话前，把上一个导入按歌单落盘，保证其歌单页仍可"继续导入"
    const prev = sessionRef.current
    if (prev.targetPlaylistId && prev.playlist) writeRecord(prev)
    commit({ status: 'fetching', playlist: null, results: [], selected: {}, progress: null, targetPlaylistId: null, startedAt: Date.now() })
    try {
      const ext = await fetchExternalPlaylist(url)
      // 预先创建目标歌单：匹配过程增量写入，保证"部分成功即可用、可边导入边听"
      const newPlaylist = createPlaylist({
        name: ext.name,
        description: `从${ext.source === 'netease' ? '网易云' : 'QQ音乐'}导入`,
        coverUrl: ext.coverUrl || '',
      })
      const results: (MatchResult | null)[] = ext.tracks.map(() => null)
      commit({
        status: 'matching',
        playlist: ext,
        results,
        selected: {},
        progress: { current: 0, total: ext.tracks.length, trackName: '', matched: 0, notFound: 0, failed: 0, phase: 'searching' },
        targetPlaylistId: newPlaylist.id,
        startedAt: Date.now(),
      })
      await runMatching(ext, results)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败')
      commit(emptySession())
    }
  }, [commit, runMatching, writeRecord])

  const pause = useCallback(() => {
    const s = sessionRef.current
    if (s.status !== 'matching') return
    pausedRef.current = true
    commit({ ...s, status: 'paused' })
  }, [commit])

  const resume = useCallback(() => {
    const s = sessionRef.current
    if (s.status !== 'paused') return
    pausedRef.current = false
    const release = resumeRef.current
    resumeRef.current = () => {}
    commit({ ...s, status: 'matching' })
    release()
  }, [commit])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    pausedRef.current = false
    const release = resumeRef.current
    resumeRef.current = () => {}
    const s = sessionRef.current
    if (s.status === 'matching' || s.status === 'paused') {
      commit({ ...s, status: 'done' })
    }
    release()
  }, [commit])

  const retryPending = useCallback(async () => {
    const s = sessionRef.current
    if (!s.playlist) return
    if (runningRef.current) return
    // 未完成项（未处理/失败/待确认/未找到）由 runMatching 按"无已选结果"判定并续跑
    commit({ ...s, status: 'matching' })
    await runMatching(s.playlist, s.results)
  }, [commit, runMatching])

  // 歌单页右上角"继续导入"：从按歌单记录恢复会话并续跑未完成项
  const resumePlaylist = useCallback(async (playlistId: string) => {
    const rec = recordsRef.current[playlistId]
    if (!rec) return
    if (runningRef.current) return // 另一个导入正在跑，避免并发
    commit({
      status: 'matching',
      playlist: rec.playlist,
      results: rec.results,
      selected: rec.selected,
      progress: { current: 0, total: rec.playlist.tracks.length, trackName: '', matched: 0, notFound: 0, failed: 0, phase: 'searching' },
      targetPlaylistId: rec.targetPlaylistId,
      startedAt: Date.now(),
    })
    await runMatching(rec.playlist, rec.results)
  }, [commit, runMatching])

  const selectCandidate = useCallback((index: number, cand: MatchCandidate) => {
    const s = sessionRef.current
    // 未处理的曲目（结果为空）也可手动指定：从歌单源曲目构建一个占位结果
    let r = s.results[index]
    if (!r) {
      const t = s.playlist?.tracks[index]
      if (!t) return
      r = { query: { name: t.name, artist: t.artist }, candidates: [] }
    }
    const prevChosen = s.selected[index] ?? r.bestMatch?.bvid
    // 手动查找选中的候选可能不在原列表里：并入 candidates，确认/导出才找得到
    const hasCand = r.candidates.some((c) => c.bvid === cand.bvid)
    const nextResults = [...s.results]
    if (!hasCand) nextResults[index] = { ...r, candidates: [cand, ...r.candidates] }
    const nextSelected = { ...s.selected, [index]: cand.bvid }
    // 增量歌单同步：替换旧的自动匹配项（如有）
    if (s.targetPlaylistId) {
      if (prevChosen && prevChosen !== cand.bvid) {
        removeTracksFromPlaylist(s.targetPlaylistId, [prevChosen])
      }
      writeResultToPlaylist(s.targetPlaylistId, r.query, cand)
    }
    const c = deriveCounts(nextResults, nextSelected)
    const progress = s.progress
      ? { ...s.progress, matched: c.matched, notFound: c.notFound, failed: c.failed }
      : { current: c.done, total: nextResults.length, trackName: '', matched: c.matched, notFound: c.notFound, failed: c.failed, phase: 'searching' as const }
    commit({ ...s, results: nextResults, selected: nextSelected, progress })
  }, [commit, writeResultToPlaylist])

  const clearSession = useCallback(() => {
    // 放弃导入：同时移除该歌单的续导记录
    const s = sessionRef.current
    if (s.targetPlaylistId && recordsRef.current[s.targetPlaylistId]) {
      const next = { ...recordsRef.current }
      delete next[s.targetPlaylistId]
      recordsRef.current = next
      setRecords(next)
      saveRecords(next)
    }
    commit(emptySession())
    try { localStorage.removeItem(SESSION_KEY) } catch { /* ignore */ }
  }, [commit])

  return (
    <ImportContext.Provider
      value={{ session, records, error, startImport, pause, resume, cancel, retryPending, resumePlaylist, selectCandidate, clearSession }}
    >
      {children}
    </ImportContext.Provider>
  )
}

export function useImport(): ImportContextValue {
  const ctx = useContext(ImportContext)
  if (!ctx) throw new Error('useImport must be used within ImportProvider')
  return ctx
}
