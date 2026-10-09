import { ipcMain, net } from 'electron'

// 外部歌单获取：网易云 / QQ音乐
// 渲染进程直接 fetch 外部 API 会被 CORS 拦截，故经主进程代理。

const NETBASE_REFERER = { headers: { Referer: 'https://music.163.com' } }

const QQ_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

// QQ音乐 JSON API 请求头（不带 text/html 的 Accept，避免影响 JSON 返回）
const QQ_API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

// QQ 接口偶尔返回 JSONP/带前缀文本，做一次容错解析
function parseQQJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('QQ音乐歌单解析失败：无法解析响应')
  }
}

// QQ音乐官方导出分享短链（c6.y.qq.com/base/fcgi-bin/u?__=key）解析：
// 短链本身不含歌单ID，需要跟随重定向拿到真实歌单页 URL 再提取 disstid。
// 服务器端可能因反爬/登录状态拒绝（404），此时给出可操作的错误提示。
function extractQQPlaylistId(url: string): string | null {
  const m =
    url.match(/\/(?:playlist|disstid)\/(\d{4,})/) ||
    url.match(/(?:disstid|dissid|playlist_id)[=&](\d{4,})/) ||
    url.match(/[?&]id=(\d{4,})/)
  return m ? m[1] : null
}

function extractQQPlaylistIdFromBody(body: string): string | null {
  if (!body) return null
  const target =
    body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^>]*url=([^"'>]+)/i)?.[1] ||
    body.match(/window\.location\.(?:href|replace)\s*=\s*['"]([^'"]+)/)?.[1] ||
    body.match(/https?:\/\/[^'"<\s]*(?:playlist|disstid)[^'"<\s]*/)?.[0]
  return target ? extractQQPlaylistId(target) : null
}

async function resolveQQShareKey(key: string): Promise<string> {
  // 分享 key 在用户本地网络环境下解析（数据中心 IP 常被反爬拦截，404 不代表链接失效）
  for (const host of ['c.y.qq.com', 'c6.y.qq.com', 'i.y.qq.com', 'm.y.qq.com']) {
    try {
      const resp = await net.fetch(`https://${host}/base/fcgi-bin/u?__=${encodeURIComponent(key)}`, {
        headers: QQ_BROWSER_HEADERS,
        redirect: 'follow',
      })
      const id = extractQQPlaylistId(resp.url)
      if (id) return id
      const fromBody = extractQQPlaylistIdFromBody(await resp.text())
      if (fromBody) return fromBody
    } catch {
      // 尝试下一个 host
    }
  }
  throw new Error(
    '无法解析QQ音乐分享链接：链接可能已失效或需要登录。请改用歌单页面链接（y.qq.com/n/ryqq/playlist/歌单ID）或直接粘贴歌单ID',
  )
}

/**
 * 网易云歌单详情接口未登录时只返回前 ~10 首歌曲（tracks 字段），
 * 但 trackIds 字段包含全部歌曲 ID。因此分两步：
 *  1. playlist/detail 拿歌单信息 + 全部 trackIds
 *  2. 分批调用 /api/v3/song/detail 批量补全歌曲详情
 */
async function fetchFullNeteasePlaylist(id: string) {
  const detailResp = await net.fetch(
    `https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000`,
    NETBASE_REFERER,
  )
  const detail = await detailResp.json()
  if (detail.code !== 200) {
    throw new Error(`网易云歌单获取失败: ${detail.msg || detail.message || '未知错误'}`)
  }

  const playlist = detail.playlist
  const trackIds: number[] = (playlist.trackIds || []).map((t: any) => Number(t.id))
  const initialTracks: any[] = playlist.tracks || []

  // 已含全部曲目（较少见），直接返回
  if (initialTracks.length >= trackIds.length && trackIds.length > 0) {
    return { playlist, tracks: initialTracks }
  }

  // 分批获取完整歌曲详情（每批 200，v3/song/detail 单次上限约 1000）
  const allTracks: any[] = [...initialTracks]
  const seenIds = new Set(initialTracks.map((t) => Number(t.id)))
  const BATCH = 200

  for (let i = 0; i < trackIds.length; i += BATCH) {
    const batchIds = trackIds.slice(i, i + BATCH)
    const c = JSON.stringify(batchIds.map((id) => ({ id })))
    const songResp = await net.fetch('https://music.163.com/api/v3/song/detail', {
      ...NETBASE_REFERER,
      method: 'POST',
      body: `c=${encodeURIComponent(c)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://music.163.com',
      },
    })
    const songData = await songResp.json()
    const songs: any[] = songData?.songs || []
    for (const song of songs) {
      const sid = Number(song.id)
      if (!seenIds.has(sid)) {
        seenIds.add(sid)
        allTracks.push(song)
      }
    }
  }

  return { playlist, tracks: allTracks }
}

/**
 * QQ音乐歌单：byids 接口(fcg_ucc_getcdinfo_byids_cp.fcg)对超长歌单可能只返回前一部分。
 * 因此先用它拿到 cdlist[0]（含总数 songnum + 首批 songlist），若发现被截断，
 * 再用支持分页的 fcg_v8_playlist_cp.fcg（song_begin/song_num）补全剩余曲目。
 * 小歌单（未截断）完全走原路径，行为不变。
 */
async function fetchFullQQPlaylist(id: string) {
  const firstUrl = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${id}&format=json`
  const resp = await net.fetch(firstUrl, { headers: QQ_API_HEADERS })
  const data = parseQQJson(await resp.text())

  const cd = data?.cdlist?.[0]
  if (!cd) return data // 无 cdlist：交给前端提示"需要登录或歌单不存在"

  const songlist: any[] = cd.songlist || []
  const total = Number(cd.songnum ?? cd.total_song_num ?? songlist.length) || songlist.length
  console.log(`[QQ导入] 歌单 ${id}：总数=${total}，首批返回=${songlist.length}`)

  // 未截断（或拿不到可信总数）→ 保持原行为
  if (songlist.length >= total) return data

  // 分页补全剩余曲目（按 songmid 去重，避免端点重叠返回）
  const seen = new Set(songlist.map((s) => s.songmid || s.songid || s.mid || s.id))
  const PAGE = 100
  for (let begin = songlist.length; begin < total; begin += PAGE) {
    const pageUrl =
      `https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?type=1&json=1&utf8=1&onlysong=0&newsong=1&format=json` +
      `&platform=yqq&hostUin=0&needNewCode=0&id=${id}&disstid=${id}&song_begin=${begin}&song_num=${PAGE}`
    try {
      const pageResp = await net.fetch(pageUrl, { headers: QQ_API_HEADERS })
      const pageSongs: any[] = parseQQJson(await pageResp.text())?.cdlist?.[0]?.songlist || []
      if (pageSongs.length === 0) break // 无更多数据，防止死循环
      let added = 0
      for (const s of pageSongs) {
        const key = s.songmid || s.songid || s.mid || s.id
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        songlist.push(s)
        added++
      }
      if (added === 0) break // 全是重复，说明端点不再返回新数据
    } catch (e) {
      console.warn(`[QQ导入] 分页补全失败 begin=${begin}：`, e)
      break // 补全失败则返回已抓到的部分，好过整体报错
    }
  }

  cd.songlist = songlist
  console.log(`[QQ导入] 歌单 ${id}：补全后共 ${songlist.length} 首`)
  return data
}

export function registerPlaylistImportHandlers() {
  // 网易云歌单
  ipcMain.handle('playlist:netease', async (_event, id: string) => {
    return fetchFullNeteasePlaylist(id)
  })

  // QQ音乐歌单（id 为纯数字时为歌单ID，否则按分享 key 解析）
  ipcMain.handle('playlist:qq', async (_event, id: string) => {
    if (!/^\d+$/.test(id)) {
      id = await resolveQQShareKey(id)
    }
    return fetchFullQQPlaylist(id)
  })
}
