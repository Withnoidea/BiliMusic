/**
 * 歌单匹配服务
 *
 * 将外部曲目（网易云/QQ音乐）匹配到B站对应视频。
 * 核心流程：用 "曲名 + 艺人" 搜索B站 → 对结果打分 → 返回最佳候选。
 */

import { searchVideo, toHttpsUrl, BiliApiError, type SearchResult } from './bilibiliApi'

export type MatchConfidence = 'exact' | 'cover' | 'remix' | 'live' | 'weak' | 'none'

export interface MatchCandidate {
  bvid: string
  title: string
  uploader: string
  playCount: number
  duration: string
  coverUrl: string
  score: number
  confidence: MatchConfidence
  reason: string
}

export interface MatchError {
  /** B站业务错误码（网络错误时无） */
  code?: number
  kind: 'risk-control' | 'network' | 'unknown'
}

export interface MatchResult {
  query: { name: string; artist: string }
  candidates: MatchCandidate[]
  bestMatch?: MatchCandidate
  /** 搜索失败（被风控/网络/其它）时置位；用于与"真的没搜到"（error 为空且 candidates 为空）区分 */
  error?: MatchError
}

export interface PlaylistMatchProgress {
  current: number
  total: number
  trackName: string
  /** 已匹配到 bestMatch 的数量 */
  matched: number
  /** 搜索正常但确实没搜到（无候选、无 error）的数量 */
  notFound: number
  /** 搜索失败（被风控/网络等）的数量 */
  failed: number
  phase: 'searching' | 'cooldown' | 'retrying'
  /** 处于 cooldown 阶段时的冷却时长（ms） */
  cooldownMs?: number
}

// ===== 标题清洗 =====

const TITLE_NOISE = [
  /【.*?】/g, /\[.*?\]/g, /（.*?）/g, /\(.*?\)/g,
  /官方MV/gi, /官方版/gi, /高清MV/gi, /高清版/gi,
  /完整版/gi, /完整音频/gi,
  /纯音乐/gi, /纯享版/gi,
  /高音质/gi, /无损/gi, /HQ/gi, /SQ/gi,
  /MV版/gi, /mv版/gi,
  /live版/gi, /现场版/gi,
  /翻唱版/gi, /cover版/gi,
  /建议戴耳机/gi, /深夜电台/gi,
  /\.mp4/gi, /\.flac/gi, /\.mp3/gi,
]

function cleanTitle(title: string): string {
  // B站搜索结果标题带 <em class="keyword"> 高亮标签，先去标签再清噪音，否则标题相似度全被打乱
  let cleaned = title.replace(/<[^>]*>/g, '')
  for (const pattern of TITLE_NOISE) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned.trim()
}

// ===== 相似度计算 =====

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/\\:：，、。.,!?！？'"《》<>]/g, '')
}

/** 编辑距离 (Levenshtein) */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp = new Array(n + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j - 1] + 1, dp[j] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[n]
}

function titleSimilarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 100
  if (na.includes(nb) || nb.includes(na)) return 85
  const maxLen = Math.max(na.length, nb.length)
  const dist = levenshtein(na, nb)
  return Math.max(0, 100 - (dist / maxLen) * 200)
}

function artistMatch(trackArtist: string, videoTitle: string, videoUploader: string): number {
  const na = normalize(trackArtist)
  const nt = normalize(videoTitle)
  const nu = normalize(videoUploader)
  if (!na) return 30
  if (nt.includes(na) || nu.includes(na)) return 100
  // 多人合唱场景，至少部分匹配
  const artists = trackArtist.split(/[\/&,，]/).map(a => normalize(a)).filter(Boolean)
  if (artists.length > 1) {
    const matched = artists.some(a => nt.includes(a) || nu.includes(a))
    if (matched) return 80
  }
  return 10
}

function detectConfidence(
  titleSim: number,
  artistScore: number,
  videoTitle: string,
): MatchConfidence {
  if (titleSim >= 85 && artistScore >= 80) return 'exact'
  const lower = videoTitle.toLowerCase()
  if (/remix|混音版|remix版/.test(lower) && titleSim >= 70) return 'remix'
  if (/cover|翻唱/.test(lower) && titleSim >= 70) return 'cover'
  if (/live|现场|演唱会/.test(lower) && titleSim >= 70) return 'live'
  if (titleSim >= 60 && artistScore >= 50) return 'cover'
  if (titleSim >= 50) return 'weak'
  return 'none'
}

function parseDuration(durationStr: string): number {
  // "3:45" → 225 秒
  if (!durationStr) return 0
  const parts = durationStr.split(':')
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
  if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  return 0
}

function durationScore(trackDuration: number | undefined, videoDurationStr: string): number {
  if (!trackDuration) return 50 // 无时长信息，给中性分
  const videoDuration = parseDuration(videoDurationStr)
  if (!videoDuration) return 50
  const diff = Math.abs(trackDuration - videoDuration)
  if (diff <= 3) return 100
  if (diff <= 10) return 80
  if (diff <= 20) return 60
  if (diff <= 30) return 40
  return 20
}

function playCountBoost(play: number): number {
  if (play >= 1000000) return 100
  if (play >= 100000) return 70
  if (play >= 10000) return 40
  if (play >= 1000) return 20
  return 5
}

// ===== 单曲匹配 =====

/** 对单条搜索结果打分，产出候选 */
function scoreCandidate(
  r: SearchResult,
  name: string,
  artist: string,
  duration?: number,
): MatchCandidate {
  // B站搜索结果的 title/author 可能带 <em class="keyword"> 高亮标签，先剥掉再参与打分与展示
  const rawTitle = r.title.replace(/<[^>]*>/g, '')
  const rawAuthor = r.author.replace(/<[^>]*>/g, '')
  const cleanedTitle = cleanTitle(rawTitle)
  const titleSim = titleSimilarity(name, cleanedTitle)
  const artistScore = artistMatch(artist, rawTitle, rawAuthor)
  const durScore = durationScore(duration, r.duration)
  const playBoost = playCountBoost(r.play)
  const confidence = detectConfidence(titleSim, artistScore, rawTitle)

  // 综合评分：标题相似度权重最高，其次艺人匹配，再次时长，播放量做微调
  const score = Math.round(
    titleSim * 0.45 +
    artistScore * 0.25 +
    durScore * 0.15 +
    playBoost * 0.15,
  )

  const reasons: string[] = []
  if (titleSim >= 85) reasons.push('标题匹配')
  else if (titleSim >= 60) reasons.push('标题近似')
  if (artistScore >= 80) reasons.push('艺人匹配')
  if (durScore >= 80) reasons.push('时长接近')
  if (!reasons.length) reasons.push('弱关联')

  return {
    bvid: r.bvid,
    title: rawTitle,
    uploader: rawAuthor,
    playCount: r.play,
    duration: r.duration,
    coverUrl: toHttpsUrl(r.pic),
    score,
    confidence,
    reason: reasons.join(' · '),
  }
}

/** 用给定关键词搜索并打分，返回按分降序的候选（可能抛出 BiliApiError） */
async function searchAndScore(
  query: string,
  name: string,
  artist: string,
  duration?: number,
): Promise<MatchCandidate[]> {
  const searchResp = await searchVideo(query, 1, 20)
  const results = searchResp.result || []
  if (results.length === 0) return []
  const candidates = results.map((r: SearchResult) => scoreCandidate(r, name, artist, duration))
  candidates.sort((a, b) => b.score - a.score)
  return candidates
}

/** 候选已按分降序：取第一个 confidence 非 none 的作为最佳（修复原先只看 index 0 的 bug） */
function pickBest(candidates: MatchCandidate[]): MatchCandidate | undefined {
  return candidates.find((c) => c.confidence !== 'none')
}

/** 合并两批候选、按 bvid 去重、重新按分降序 */
function mergeCandidates(a: MatchCandidate[], b: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set(a.map((c) => c.bvid))
  const merged = [...a]
  for (const c of b) {
    if (!seen.has(c.bvid)) {
      seen.add(c.bvid)
      merged.push(c)
    }
  }
  merged.sort((x, y) => y.score - x.score)
  return merged
}

export async function matchTrack(
  name: string,
  artist: string,
  duration?: number,
): Promise<MatchResult> {
  const cleanedName = cleanTitle(name) || name
  // 只用主歌手拼查询，避免整串 "A / B / C" 里的 "/" 伤 B站搜索命中；完整歌手串仍用于打分
  const primaryArtist = artist.split(/[\/&,，]/)[0]?.trim() || artist

  // 第一段：曲名 + 主歌手
  let candidates = await searchAndScore(`${cleanedName} ${primaryArtist}`.trim(), name, artist, duration)
  let best = pickBest(candidates)

  // 没有可接受的匹配时，第二段：仅用曲名再搜一次以提升召回，合并去重后重新择优
  if (!best) {
    const more = await searchAndScore(cleanedName, name, artist, duration)
    candidates = mergeCandidates(candidates, more)
    best = pickBest(candidates)
  }

  return { query: { name, artist }, candidates, bestMatch: best }
}

/** 手动查找：按用户输入的关键词搜索并打分，返回全部候选（与自动匹配同一套打分与择优） */
export async function searchManualCandidates(
  query: string,
  name: string,
  artist: string,
  duration?: number,
): Promise<MatchCandidate[]> {
  return searchAndScore(query, name, artist, duration)
}

// ===== 整个歌单匹配 =====

const RISK_CODES = new Set([-352, -412, -799, -509]) // 风控/限流类错误码
const BASE_DELAY = 350 // 每首之间基础间隔（ms）
const DELAY_JITTER = 150 // 间隔抖动 ±（ms）
const MAX_DELAY = 1500 // 自适应间隔上限
const MAX_RETRIES = 4 // 单首风控最大重试次数
const COOLDOWN_BASE = 3000 // 风控冷却基准（ms）
const COOLDOWN_MAX = 30000 // 风控冷却上限（ms）

/** 可被 AbortSignal 打断的 sleep */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function jitteredDelay(base: number): number {
  return Math.max(0, base + (Math.random() * 2 - 1) * DELAY_JITTER)
}

/** 把抛出的错误归类为风控 / 网络 / 其它业务码 */
function classifyError(err: unknown): MatchError {
  const code = err instanceof BiliApiError ? err.code : (err as { code?: number })?.code
  if (typeof code === 'number') {
    return RISK_CODES.has(code) ? { code, kind: 'risk-control' } : { code, kind: 'unknown' }
  }
  return { kind: 'network' } // 无业务码，通常是网络错误 / JSON 解析失败
}

export interface MatchPlaylistOptions {
  signal?: AbortSignal
  /** 暂停钩子：每首开始前调用；返回 Promise 时阻塞直到 resolve（返回 null/undefined 表示未暂停） */
  pause?: (signal?: AbortSignal) => Promise<void> | null
  /** 每首处理完（含失败/未找到）回调，index 为 tracks 数组内下标，便于调用方增量落盘/写歌单 */
  onResult?: (index: number, result: MatchResult) => void
}

/**
 * 匹配整个歌单。相比原始"裸循环 + 空 catch"，本实现：
 *  - 每首之间自适应节流（抖动），避免瞬间连打触发 B站风控；
 *  - 检测到风控码时全批指数退避冷却后重试（风控是全局状态），并调大后续间隔；
 *  - 网络错误短重试；重试耗尽标记为 error（而非"未找到"），绝不整批中断；
 *  - 通过 onProgress 上报实时 matched/notFound/failed 计数与冷却状态；
 *  - 通过 onResult 逐首回调结果（支持增量写入/持久化）；
 *  - 支持 AbortSignal 取消与 pause 暂停，返回已完成部分。
 */
export async function matchPlaylist(
  tracks: { name: string; artist: string; duration?: number }[],
  onProgress?: (progress: PlaylistMatchProgress) => void,
  options?: MatchPlaylistOptions,
): Promise<MatchResult[]> {
  const { signal, pause, onResult } = options || {}
  const results: MatchResult[] = []
  const total = tracks.length
  let matched = 0
  let notFound = 0
  let failed = 0
  let currentDelay = BASE_DELAY
  let consecutiveOk = 0

  const emit = (
    i: number,
    trackName: string,
    phase: PlaylistMatchProgress['phase'],
    cooldownMs?: number,
  ) => {
    onProgress?.({ current: i + 1, total, trackName, matched, notFound, failed, phase, cooldownMs })
  }

  for (let i = 0; i < tracks.length; i++) {
    if (signal?.aborted) break
    const pausePromise = pause?.(signal)
    if (pausePromise) await pausePromise
    if (signal?.aborted) break
    const track = tracks[i]
    const label = `${track.name} - ${track.artist}`
    emit(i, label, 'searching')

    let result: MatchResult | null = null
    let cooldown = COOLDOWN_BASE

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) break
      try {
        result = await matchTrack(track.name, track.artist, track.duration)
        break // 成功（含"真的没搜到"这种空结果）
      } catch (err) {
        if (signal?.aborted) break
        const info = classifyError(err)
        const base: MatchResult = { query: { name: track.name, artist: track.artist }, candidates: [], error: info }

        if (info.kind === 'risk-control' && attempt < MAX_RETRIES) {
          // 全局风控：冷却后调大间隔再重试当前曲目
          console.warn(`[导入] 触发风控 code=${info.code}，第 ${attempt + 1} 次重试前冷却 ${Math.round(cooldown / 1000)}s`)
          emit(i, label, 'cooldown', cooldown)
          try {
            await sleep(cooldown, signal)
          } catch {
            break // aborted
          }
          currentDelay = Math.min(MAX_DELAY, Math.round(currentDelay * 1.5))
          cooldown = Math.min(COOLDOWN_MAX, cooldown * 2)
          emit(i, label, 'retrying')
          continue
        }

        if (info.kind === 'network' && attempt < 2) {
          // 网络错误短重试
          try {
            await sleep(1000, signal)
          } catch {
            break // aborted
          }
          emit(i, label, 'retrying')
          continue
        }

        result = base // 风控重试耗尽 / 其它业务码 / 网络重试耗尽
        break
      }
    }

    if (signal?.aborted) break
    if (!result) {
      result = { query: { name: track.name, artist: track.artist }, candidates: [], error: { kind: 'unknown' } }
    }

    results.push(result)
    onResult?.(i, result)
    if (result.error) {
      failed++
      consecutiveOk = 0
    } else {
      if (result.bestMatch) matched++
      else notFound++
      consecutiveOk++
      // 连续成功后让间隔缓慢回落到基准
      if (consecutiveOk >= 5 && currentDelay > BASE_DELAY) {
        currentDelay = Math.max(BASE_DELAY, Math.round(currentDelay * 0.8))
      }
    }
    emit(i, label, 'searching')

    // 每首之间节流（最后一首无需等待）
    if (i < tracks.length - 1) {
      try {
        await sleep(jitteredDelay(currentDelay), signal)
      } catch {
        break // aborted
      }
    }
  }

  return results
}
