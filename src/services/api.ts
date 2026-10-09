import type { Track } from '@/types'
import { parseDuration } from '@/utils/duration'
import * as rendererApi from '@/services/bilibiliApi'
/**
 * biliMusic API 适配层
 *
 * Electron 环境：通过 IPC 调用主进程 API（绕过 CORS）
 * 浏览器环境：通过 renderer 端 bilibiliApi.ts 直接调用（需要 B 站 Cookie）
 */

import type { TrackSource } from '@/services/bilibiliApi'

function isElectron(): boolean {
  return !!window.electronAPI?.biliApi
}

// ===== 搜索 =====

export interface SearchItem {
  bvid: string
  aid: number
  title: string
  author: string
  play: number
  duration: string
  pic: string
}

function normalizePic(pic: string): string {
  if (!pic) return ''
  if (pic.startsWith('https://') || pic.startsWith('data:image/')) return pic
  if (pic.startsWith('http://')) return pic.replace('http://', 'https://')
  if (pic.startsWith('//')) return `https:${pic}`
  return ''
}

export async function searchVideo(keyword: string, page = 1, pageSize = 20): Promise<{ items: SearchItem[]; totalPages: number; totalResults: number }> {
  const mapItem = (item: any): SearchItem => ({
    bvid: item.bvid,
    aid: item.aid,
    title: item.title?.replace(/<[^>]+>/g, ''),
    author: item.author,
    play: item.play,
    duration: item.duration,
    pic: normalizePic(item.pic),
  })

  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { searchVideo: rendererSearch } = rendererApi
  const data = await rendererSearch(keyword, page, pageSize)
  const totalResults = data.numResults || 0
  return {
    items: data.result?.map(mapItem) || [],
    totalPages: data.numPages || Math.ceil(totalResults / pageSize),
    totalResults,
  }
}

// ===== 视频详情 =====

export interface VideoInfo {
  bvid: string
  aid: number
  title: string
  desc: string
  tags?: string
  musicCategory?: boolean
  album?: string
  pic: string
  ownerName: string
  ownerMid: number
  duration: number
  cid: number
  stat: {
    view: number
    like: number
    favorite: number
  }
}

export async function getVideoDetail(bvid: string): Promise<VideoInfo> {
  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { getVideoDetail: rendererDetail } = rendererApi
  const data = await rendererDetail(bvid)
  return {
    bvid: data.bvid,
    aid: data.aid,
    title: data.title,
    desc: data.desc?.substring(0, 100),
    pic: data.pic,
    ownerName: data.owner?.name,
    ownerMid: data.owner?.mid,
    duration: data.duration,
    cid: data.cid,
    stat: {
      view: data.stat?.view,
      like: data.stat?.like,
      favorite: data.stat?.favorite,
    },
  }
}

// ===== 评论 =====

export interface VideoComment {
  id: number
  author: string
  avatar: string
  message: string
  like: number
  replyCount: number
  createdAt: number
}

export async function getVideoComments(
  target: { bvid?: string; aid?: string | number },
  page = 1,
  pageSize = 20,
): Promise<{ items: VideoComment[]; total: number }> {
  const { getVideoDetail: rendererDetail, getVideoComments: rendererComments } = rendererApi
  let oid = 0

  if (target.bvid) {
    try {
      const detail = await rendererDetail(target.bvid)
      oid = Number(detail.aid) || 0
    } catch {
      oid = 0
    }
  }

  if (!oid) {
    oid = Number(target.aid) || 0
  }

  if (!oid) {
    throw new Error('无法获取当前视频的评论区 ID')
  }

  const data = await rendererComments(oid, page, pageSize)
  const replies = data.replies || []
  return {
    items: replies.map((reply) => ({
      id: reply.rpid,
      author: reply.member?.uname || 'Bilibili 用户',
      avatar: normalizePic(reply.member?.avatar || ''),
      message: reply.content?.message || '',
      like: reply.like || 0,
      replyCount: reply.rcount || 0,
      createdAt: reply.ctime || 0,
    })),
    total: data.page?.count || replies.length,
  }
}

// ===== 提取音频 =====

export async function extractAudio(
  bvid: string,
  fallback?: { aid?: string | number; cid?: string | number },
): Promise<TrackSource> {
  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { extractAudioFromVideo } = rendererApi
  return extractAudioFromVideo(bvid, fallback)
}

// ===== 下载音频 =====

export async function downloadAudio(audioUrl: string, filename: string): Promise<{ filePath: string; size: number }> {
  if (isElectron()) {
    return window.electronAPI.biliApi.downloadAudio(audioUrl, filename)
  }

  throw new Error('Audio download requires Electron environment')
}

// ===== 用户信息 =====

export async function getUserInfo(): Promise<{ isLogin: boolean; mid: number; uname: string; face: string }> {
  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { getNavInfo } = rendererApi
  const data = await getNavInfo()
  return {
    isLogin: data.isLogin,
    mid: data.mid,
    uname: data.uname,
    face: data.face || '',
  }
}

// ===== 音乐排行榜 =====

export type DiscoverSource = 'hot' | 'original' | 'latest'
export async function getMusicRanking(options: { source?: DiscoverSource; page?: number; pageSize?: number } = {}): Promise<VideoInfo[]> {
  const parseItem = (v: any): VideoInfo => {
    const dur = typeof v.duration === 'string'
      ? v.duration.split(':').reduce((acc: number, t: string) => acc * 60 + parseInt(t), 0)
      : (v.duration || 0)
    return {
      bvid: v.bvid,
      aid: v.aid,
      title: v.title,
      desc: v.description || v.desc || '',
      tags: v.tag || '',
      musicCategory: true,
      pic: normalizePic(v.pic),
      ownerName: v.author || v.owner?.name || '',
      ownerMid: v.mid || v.owner?.mid || 0,
      duration: dur,
      cid: v.cid || 0,
      stat: {
        view: v.play || v.stat?.view || 0,
        like: v.stat?.like || 0,
        favorite: v.favorites || v.stat?.favorite || 0,
      },
    }
  }

  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { getMusicRanking: rendererRanking } = rendererApi
  const data = await rendererRanking(options)
  return cleanMusicVideos((Array.isArray(data) ? data : (data as any).list || (data as any).data || []).map(parseItem))
}

// ===== 音乐中心（music.bilibili.com/pc/music-center 同源数据） =====

export interface MusicSong {
  bvid: string
  aid: string
  cid: string
  title: string
  artist: string
  coverUrl: string
  album: string
  duration: number | string
  publishTime?: string
}

// 综合榜顶层 bvid 是 music-metadata 伪 id（/x/web-interface/view 返回 -404），
// 实际可播放稿件在 related_archive.bvid；新歌无 related_archive，用顶层 bvid。
function playableBvid(x: import('@/services/bilibiliApi').MusicCenterItem): string {
  return x.related_archive?.bvid || x.bvid
}

function mapMusicSong(x: import('@/services/bilibiliApi').MusicCenterItem): MusicSong {
  return {
    bvid: playableBvid(x),
    // 顶层 avid+cid：bvid 稿件 -404 时的回退音源（related_archive.cid 不可靠）
    aid: String(x.aid || ''),
    cid: String(x.cid || ''),
    title: x.music_title,
    artist: x.author,
    coverUrl: normalizePic(x.cover),
    album: x.album || '',
    publishTime: x.publish_time,
    duration: parseDuration(x.duration, x.related_archive?.duration),
  }
}

const durationCache = new Map<string, number>()
async function enrichSongDurations(songs: MusicSong[]): Promise<MusicSong[]> {
  let cursor = 0
  // Bound detail requests to avoid flooding the API when a chart omits durations.
  await Promise.all(Array.from({ length: Math.min(4, songs.length) }, async () => {
    while (cursor < songs.length) {
      const song = songs[cursor++]
      if (parseDuration(song.duration)) continue
      if (durationCache.has(song.bvid)) { song.duration = durationCache.get(song.bvid)!; continue }
      try {
        const detail = await rendererApi.getVideoDetail(song.bvid)
        song.duration = parseDuration(detail.duration, detail.pages?.find(p => String(p.cid) === song.cid)?.duration, detail.pages?.[0]?.duration)
        if (song.duration) durationCache.set(song.bvid, Number(song.duration))
      } catch { /* Unknown is displayed as --:--, never a fabricated song length. */ }
    }
  }))
  return songs
}

// 综合热歌榜
export async function getMusicCenterRank(ps = 30): Promise<MusicSong[]> {
  const { getMusicComprehensiveRank } = rendererApi
  const list = await getMusicComprehensiveRank(ps)
  return enrichSongDurations(list.filter((x) => playableBvid(x)).map(mapMusicSong))
}

// 新歌速递
export async function getNewSongs(): Promise<MusicSong[]> {
  const { getNewMusic } = rendererApi
  const list = await getNewMusic()
  return enrichSongDurations(list.filter((x) => x.bvid).map(mapMusicSong))
}

// ===== 搜索 UP主 =====

export interface UserResult {
  mid: number
  name: string
  avatar: string
  sign: string
  fans: number
  videoCount: number
  level: number
}

export async function searchUsers(keyword: string, page = 1, pageSize = 20): Promise<{ items: UserResult[]; totalPages: number; totalResults: number }> {
  const { searchUser } = rendererApi
  const data = await searchUser(keyword, page, pageSize)
  const items = (data.result || []).map((u) => ({
    mid: u.mid,
    name: u.uname?.replace(/<[^>]+>/g, '') || '',
    avatar: normalizePic(u.upic),
    sign: u.usign || '',
    fans: u.fans || 0,
    videoCount: u.videos || 0,
    level: u.level || 0,
  }))
  const totalResults = data.numResults || 0
  return { items, totalPages: data.numPages || Math.ceil(totalResults / pageSize), totalResults }
}

// ===== UP主 投稿视频 =====

export interface UpVideo {
  bvid: string
  title: string
  coverUrl: string
  duration: number
  play: number
  created: number
}

// "mm:ss" / "hh:mm:ss" → 秒
function parseLength(len: string): number {
  if (!len) return 0
  const parts = len.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

export async function getUserVideos(mid: number, page = 1, pageSize = 30): Promise<{ items: UpVideo[]; total: number }> {
  const { getUserVideos: rendererUserVideos } = rendererApi
  const data = await rendererUserVideos(mid, page, pageSize)
  const items = (data.list?.vlist || []).map((v) => ({
    bvid: v.bvid,
    title: v.title?.replace(/<[^>]+>/g, '') || '',
    coverUrl: normalizePic(v.pic),
    duration: parseLength(v.length),
    play: v.play || 0,
    created: v.created || 0,
  }))
  return { items, total: data.page?.count || 0 }
}

// ===== 个性化推荐 =====

function feedVideo(v: rendererApi.PopularVideo): VideoInfo {
  return {
    bvid: v.bvid, aid: v.aid || v.id || 0, title: stripMarkup(v.title), desc: v.desc || '',
    tags: v.tag || '', musicCategory: MUSIC_REGIONS.has(v.tid || 0) || /音乐|原创歌曲|翻唱|演奏/.test(v.tname || ''),
    pic: normalizePic(v.pic), ownerName: v.owner?.name || '', ownerMid: v.owner?.mid || 0,
    duration: parseDuration(v.duration), cid: v.cid || 0,
    stat: { view: v.stat?.view || 0, like: v.stat?.like || 0, favorite: v.stat?.favorite || 0 },
  }
}

export async function getRecommendVideos(ps = 20, seed = 0): Promise<VideoInfo[]> {
  const data = await rendererApi.getRecommendedVideos(ps, seed)
  const candidates = (data.item || []).filter(v => v.bvid).map(feedVideo)
  // Homepage cards often omit category and description. Hydrate a bounded sample
  // before accepting them, rather than treating the general feed as music.
  const sample = candidates.filter(v => v.duration >= 60 && v.duration <= 600).slice(0, 12)
  let cursor = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < sample.length) {
      const video = sample[cursor++]
      try { Object.assign(video, feedVideo(await rendererApi.getVideoDetail(video.bvid))) }
      catch { video.musicCategory = false }
    }
  }))
  return cleanMusicVideos(sample)
}

// ===== 热门/推荐 =====

export async function getPopularVideos(ps = 10, pn = 1): Promise<VideoInfo[]> {
  // 共用 API 适配器：桌面环境的鉴权由主进程网关代持。
  const { getPopularVideos: rendererPopular } = rendererApi
  const data = await rendererPopular(ps, pn)
  return data.list?.map((v) => ({
    bvid: v.bvid,
    aid: v.aid,
    title: v.title,
    desc: '',
    pic: normalizePic(v.pic),
    ownerName: v.owner?.name,
    ownerMid: v.owner?.mid,
    duration: v.duration,
    cid: v.cid || 0,
    stat: {
      view: v.stat?.view,
      like: v.stat?.like,
      favorite: v.stat?.favorite,
    },
  })) || []
}

// ===== 扫码登录 =====

export interface QrCodeData {
  url: string
  qrcodeKey: string
}

export interface QrPollResult {
  confirmed?: boolean
  retryable?: boolean
  code: number
  status: number
  message: string
  url: string
}

export async function generateQrCode(): Promise<QrCodeData> {
  if (isElectron()) {
    const data = await window.electronAPI.biliApi.qrGenerate()
    return { url: data.url, qrcodeKey: data.qrcodeKey }
  }

  const { generateQrCode: rendererGen } = rendererApi
  return rendererGen()
}

export async function pollQrCode(qrcodeKey: string): Promise<QrPollResult> {
  if (isElectron()) {
    return window.electronAPI.biliApi.qrPoll(qrcodeKey)
  }

  const { pollQrCode: rendererPoll } = rendererApi
  return rendererPoll(qrcodeKey)
}

export async function getLoginStatus(): Promise<{ isLoggedIn: boolean; isLogin: boolean; uid: string; uname: string; face: string }> {
  if (isElectron()) return window.electronAPI.biliApi.getLoginStatus()
  const info = await getUserInfo()
  return { isLoggedIn: info.isLogin, isLogin: info.isLogin, uid: String(info.mid || ''), uname: info.uname, face: info.face }
}

export async function logout(): Promise<void> {
  if (isElectron()) {
    await window.electronAPI.biliApi.logout()
    return
  }

  // 浏览器环境无法清除 bilibili.com 的 Cookie（跨域）
  throw new Error('Logout requires Electron environment')
}

// ===== Shared clean music feed: no relaxed fallback to unrelated popular videos =====
const MUSIC_REGIONS = new Set([3, 28, 29, 30, 31, 59, 130, 193, 243, 244, 265, 266, 267])
const MUSIC_BLACKLIST = /教程|开箱|评测|解说|伴奏分享|教学|求谱|乐理|聊天|访谈|直播回放|直播录像|全程回放|reaction|乐评|盘点|音乐分析|歌曲解析/i
const MUSIC_WHITELIST = /\b(?:MV|Cover|Official|Live)\b|翻唱|单曲|原创|现场|原唱|演唱|演奏|纯音乐|歌曲|新歌|音乐剧|主题曲|插曲|片尾曲|片头曲|电音|摇滚|民谣|国风|古风|\b(?:OST|OP|ED)\b/i
const MUSIC_SIGNAL = /\b(?:MV|Cover|OST)\b|翻唱|单曲|歌曲|演唱|演奏|纯音乐|主题曲|插曲|片尾曲|片头曲|原创音乐|电音|摇滚|民谣/i
const MUSIC_TAGS = ['ACG 动漫歌曲', '华语流行 单曲', '摇滚 现场', '电音 Official', '古风 原创', '日语 翻唱', '粤语 经典歌曲', '民谣 Live', '纯音乐 演奏', '华语 MV']
const tagPages = new Map<string, number>()
let dynamicOffset = ''
const stripMarkup = (value: string) => (value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

export function musicScore(video: VideoInfo): number {
  const title = stripMarkup(video.title)
  const text = `${title} ${stripMarkup(video.desc)} ${video.tags || ''}`
  if (!video.bvid || !Number.isFinite(video.duration) || video.duration < 60 || video.duration > 600 || MUSIC_BLACKLIST.test(text)) return -1
  // Music-region provenance or an explicit song tag is mandatory.
  if (!video.musicCategory && !MUSIC_SIGNAL.test(`${title} ${video.tags || ''}`)) return -1
  return (MUSIC_WHITELIST.test(title) ? 8 : 0) + (MUSIC_WHITELIST.test(video.tags || '') ? 4 : 0)
    + Math.min(3, Math.log10(1 + Math.max(0, video.stat.view)))
}

export function cleanMusicVideos(videos: VideoInfo[], exclude: ReadonlySet<string> = new Set()): VideoInfo[] {
  const unique = new Map<string, VideoInfo>()
  for (const video of videos) {
    if (!exclude.has(video.bvid) && !unique.has(video.bvid) && musicScore(video) >= 0) unique.set(video.bvid, { ...video, title: stripMarkup(video.title) })
  }
  return [...unique.values()].sort((a, b) => musicScore(b) - musicScore(a))
}

export interface MusicFeedOptions {
  mode: 'recommend' | 'discover'
  seed: number
  seenTrackIds: ReadonlySet<string>
  recentTracks?: Track[]
  limit?: number
}

async function searchMusicTag(keyword: string, seed: number): Promise<VideoInfo[]> {
  const page = tagPages.get(keyword) ?? (1 + seed % 5)
  tagPages.set(keyword, page + 1)
  const orders = ['totalrank', 'pubdate', 'click'] as const
  const data = await rendererApi.searchVideo(keyword, page, 50, { order: orders[seed % orders.length] })
  // Exhausted keyword pages wrap only after the server says so; the seen set
  // still prevents previously displayed IDs from being admitted again.
  if (data.numPages && page >= data.numPages) tagPages.set(keyword, 1)
  return (data.result || []).map(v => ({
    bvid: v.bvid, aid: v.aid, title: v.title, desc: v.description || '', tags: v.tag, musicCategory: true,
    pic: normalizePic(v.pic), ownerName: v.author, ownerMid: 0, duration: parseDuration(v.duration), cid: 0,
    stat: { view: v.play || 0, like: 0, favorite: 0 },
  }))
}

async function musicDynamics(): Promise<VideoInfo[]> {
  const data = await rendererApi.getMusicDynamics(dynamicOffset)
  dynamicOffset = data.offset || ''
  return (data.items || []).flatMap(item => {
    const archive = item.modules?.module_dynamic?.major?.archive
    const author = item.modules?.module_author
    return archive ? [{
      bvid: archive.bvid, aid: archive.aid || 0, title: archive.title, desc: archive.desc || '',
      pic: normalizePic(archive.cover), ownerName: author?.name || '', ownerMid: author?.mid || 0,
      duration: parseDuration(archive.duration_text), cid: 0, stat: { view: 0, like: 0, favorite: 0 },
    }] : []
  })
}

async function freshMusic(): Promise<VideoInfo[]> {
  const sources = await Promise.allSettled([getNewSongs(), getMusicCenterRank(12)])
  return sources.flatMap(source => source.status === 'fulfilled' ? source.value.map(song => ({
    bvid: song.bvid, aid: Number(song.aid) || 0, cid: Number(song.cid) || 0, title: song.title, desc: '',
    musicCategory: true, album: song.album, pic: song.coverUrl, ownerName: song.artist, ownerMid: 0,
    duration: parseDuration(song.duration), stat: { view: 0, like: 0, favorite: 0 },
  })) : [])
}

/** Interleave ranked sources so a large search pool cannot bury personalization. */
export function mixMusicPools(pools: VideoInfo[][], seen: ReadonlySet<string>, limit: number): VideoInfo[] {
  const used = new Set(seen)
  const ranked = pools.map(pool => cleanMusicVideos(pool, seen))
  const result: VideoInfo[] = []
  for (let index = 0; result.length < limit && ranked.some(pool => index < pool.length); index++) {
    for (const pool of ranked) {
      const video = pool[index]
      if (!video || used.has(video.bvid)) continue
      used.add(video.bvid)
      result.push(video)
      if (result.length === limit) break
    }
  }
  return result
}

export async function getMusicFeed(options: MusicFeedOptions): Promise<VideoInfo[]> {
  const seed = Math.abs(Math.floor(options.seed)) % 1000000
  const limit = Math.max(1, Math.min(40, options.limit || 21))
  const recent = (options.recentTracks || []).filter(track => track.bvid).slice(0, 10)
  const anchor = recent[seed % Math.max(1, recent.length)]
  const requests: Promise<VideoInfo[]>[] = [
    searchMusicTag(MUSIC_TAGS[seed % MUSIC_TAGS.length], seed),
    getMusicRanking({ source: 'latest', page: 1 + seed % 30, pageSize: 50 }),
  ]
  if (options.mode === 'recommend') {
    requests.unshift(getRecommendVideos(30, seed))
    requests.push(freshMusic(), musicDynamics())
    if (anchor) requests.push(rendererApi.getRelatedVideos(anchor.bvid).then(videos => videos.map(feedVideo)))
  }
  const settled = await Promise.allSettled(requests)
  const pools = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  let result = mixMusicPools(pools, options.seenTrackIds, limit)
  // Bounded replenishment from different genres and deeper pages, never replay
  // old songs or relax the song filter just to fill the screen.
  for (let round = 1; result.length < limit && round <= 3; round++) {
    const extra = await Promise.allSettled([1, 2].map(offset => {
      const cursor = seed + round * 2 + offset
      return searchMusicTag(MUSIC_TAGS[cursor % MUSIC_TAGS.length], cursor)
    }))
    pools.push(...extra.flatMap(item => item.status === 'fulfilled' ? [item.value] : []))
    result = mixMusicPools(pools, options.seenTrackIds, limit)
  }
  if (!result.length) throw new Error('暂未找到未展示过的合格歌曲，请再次换一换或稍后重试')
  return result
}
