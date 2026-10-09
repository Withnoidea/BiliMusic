/**
 * 外部歌单导入服务
 *
 * 解析网易云/QQ音乐歌单链接，提取曲目列表。
 * 通过 Electron 主进程 IPC 代理请求，绕过 CORS。
 */

export type PlaylistSource = 'netease' | 'qq'

export interface ExternalTrack {
  name: string
  artist: string
  album?: string
  duration?: number
}

export interface ExternalPlaylist {
  name: string
  coverUrl?: string
  description?: string
  tracks: ExternalTrack[]
  source: PlaylistSource
  sourceId: string
}

/** 从 URL 判断歌单来源并提取 ID */
export function parsePlaylistUrl(url: string): { source: PlaylistSource; id: string } | null {
  const trimmed = url.trim()

  const neteaseMatch =
    trimmed.match(/music\.163\.com.*[?&]id=(\d+)/) ||
    trimmed.match(/music\.163\.com.*playlist\/(\d+)/)
  if (neteaseMatch) return { source: 'netease', id: neteaseMatch[1] }

  const qqMatch =
    trimmed.match(/y\.qq\.com.*playlist\/(\w+)/) ||
    trimmed.match(/y\.qq\.com.*playsquare\/(\w+)/)
  if (qqMatch) return { source: 'qq', id: qqMatch[1] }

  // QQ音乐官方导出分享短链（c6.y.qq.com/base/fcgi-bin/u?__=分享key），key 在主进程解析成歌单ID
  const qqShareMatch = trimmed.match(/y\.qq\.com\/base\/fcgi-bin\/u\?[^#]*\b__=([\w-]+)/)
  if (qqShareMatch) return { source: 'qq', id: qqShareMatch[1] }

  if (/^\d+$/.test(trimmed)) return { source: 'netease', id: trimmed }

  return null
}

interface NeteeseSong {
  name: string
  ar?: { name: string }[]
  al?: { name: string; picUrl: string }
  artists?: { name: string }[]
  album?: { name: string; picUrl: string }
  dt?: number
  duration?: number
}

export async function fetchNeteasePlaylist(id: string): Promise<ExternalPlaylist> {
  const data = await window.electronAPI.playlistApi.netease(id)
  if (!data || (!data.playlist && data.code !== 200)) {
    throw new Error(`网易云歌单获取失败: ${data?.msg || data?.message || '未知错误'}`)
  }

  const playlist = data.playlist
  if (!playlist) throw new Error('网易云歌单获取失败：歌单不存在')
  // v6 detail 用 ar/al；v3 song/detail 用 artists/album，两种格式都要兼容
  const tracks: ExternalTrack[] = (data.tracks || []).map((s: NeteeseSong) => ({
    name: s.name,
    artist: (s.ar || s.artists || []).map((a) => a.name).join(' / '),
    album: s.al?.name || s.album?.name,
    duration: s.dt || s.duration ? Math.floor((s.dt || s.duration || 0) / 1000) : undefined,
  }))

  return {
    name: playlist.name,
    coverUrl: playlist.coverImgUrl,
    description: playlist.description,
    tracks,
    source: 'netease',
    sourceId: id,
  }
}

export async function fetchQQPlaylist(id: string): Promise<ExternalPlaylist> {
  const data = await window.electronAPI.playlistApi.qq(id)
  const cdlist = data?.cdlist?.[0]
  if (!cdlist) throw new Error('QQ音乐歌单获取失败：可能需要登录或歌单不存在')

  const tracks: ExternalTrack[] = (cdlist.songlist || []).map((s: any) => ({
    name: s.songname || s.name || '',
    artist: (s.singer || []).map((a: any) => a.name).join(' / '),
    album: s.albumname || s.album?.name,
    duration: s.interval,
  }))

  return {
    name: cdlist.dissname || 'QQ音乐歌单',
    coverUrl: cdlist.logo,
    description: cdlist.desc,
    tracks,
    source: 'qq',
    sourceId: id,
  }
}

/** 统一入口：根据 URL 获取外部歌单 */
export async function fetchExternalPlaylist(url: string): Promise<ExternalPlaylist> {
  const parsed = parsePlaylistUrl(url)
  if (!parsed) {
    throw new Error('无法识别歌单链接，请粘贴网易云或QQ音乐歌单完整链接')
  }

  if (parsed.source === 'netease') {
    return fetchNeteasePlaylist(parsed.id)
  } else {
    return fetchQQPlaylist(parsed.id)
  }
}
