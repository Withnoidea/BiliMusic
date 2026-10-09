import { ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { registerDownloadHandlers } from './downloads'
import { assertTrustedSender } from './security'

const BILI_API = 'https://api.bilibili.com'
const BILI_PASSPORT = 'https://passport.bilibili.com'
const BILI_REFERER = 'https://www.bilibili.com'

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => { assertTrustedSender(event); return listener(event, ...args) })
}

// ===== IPC Handlers =====

export function registerBiliApiHandlers() {
  registerDownloadHandlers()
  handle('bili:request', async (event, urlPath: string) => {
    assertTrustedSender(event)
    if (typeof urlPath !== 'string' || !urlPath.startsWith('/x/')) throw new Error('不允许的 API 路径')
    const url = new URL(urlPath, BILI_API)
    if (url.origin !== BILI_API || !API_PATHS.has(url.pathname)) throw new Error('不允许的 API 路径')
    return fetchBiliResponse(url.pathname + url.search)
  })
  // 搜索视频
  handle('bili:search', async (_event, keyword: string, page = 1, pageSize = 20) => {
    return fetchBiliApi(`/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${pageSize}`)
  })

  // 视频详情
  handle('bili:videoDetail', async (_event, bvid: string) => {
    return fetchBiliApi(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`)
  })

  // 音频流地址
  handle('bili:playUrl', async (_event, bvid: string, cid: number) => {
    return fetchBiliApi(`/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=0&fnver=0&fnval=16&fourk=1`)
  })

  // 用户信息（登录状态）
  handle('bili:nav', async () => {
    return fetchBiliApi('/x/web-interface/nav')
  })

  // 热门视频
  handle('bili:popular', async (_event, ps = 10, pn = 1) => {
    return fetchBiliApi(`/x/web-interface/popular?ps=${ps}&pn=${pn}`)
  })

  // 推荐视频
  handle('bili:recommend', async (_event, ps = 10) => {
    return fetchBiliApi(`/x/web-interface/index/top/rcmd?ps=${ps}`)
  })

  // 音乐排行榜
  handle('bili:musicRanking', async (_event, options: { source?: string; page?: number; pageSize?: number } = {}) => {
    const page = Math.max(1, Math.floor(Number(options.page) || 1))
    const size = Math.min(50, Math.max(1, Math.floor(Number(options.pageSize) || 20)))
    if (options.source === 'latest') return fetchBiliApi(`/x/web-interface/newlist?rid=3&pn=${page}&ps=${size}`)
    const data = await fetchBiliApi(`/x/web-interface/ranking/region?rid=${options.source === 'original' ? 28 : 3}&day=3&original=${options.source === 'original' ? 1 : 0}`)
    const list = Array.isArray(data) ? data : data.list || []
    const start = list.length ? ((page - 1) * size) % list.length : 0
    return list.slice(start, start + size)
  })

  // 收藏夹列表
  handle('bili:favorites', async (_event, mid: number) => {
    return fetchBiliApi(`/x/v3/fav/folder/created/list-all?up_mid=${mid}`)
  })

  // 提取完整音频源（一键流程）
  handle('bili:extractAudio', async (_event, bvid: string) => {
    const detail = await fetchBiliApi(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`)
    const playData = await fetchBiliApi(`/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${detail.cid}&qn=0&fnver=0&fnval=16&fourk=1`)

    const audioStreams = playData.dash?.audio || []
    if (!audioStreams.length) throw new Error('No audio stream available')

    const bestAudio = [...audioStreams].sort((a, b) => b.bandwidth - a.bandwidth)[0]

    return {
      bvid: detail.bvid,
      aid: detail.aid,
      cid: detail.cid,
      title: detail.title,
      artist: detail.owner?.name,
      coverUrl: detail.pic,
      duration: detail.duration,
      audioUrl: bestAudio.baseUrl,
      audioQuality: bestAudio.quality,
      audioMimeType: bestAudio.mimeType,
      bandwidth: bestAudio.bandwidth,
    }
  })

  // ===== 扫码登录 =====

  // 生成二维码
  handle('bili:qrGenerate', async () => {
    const url = `${BILI_PASSPORT}/x/passport-login/web/qrcode/generate`
    const response = await authSession().fetch(url, {
      headers: { Referer: `${BILI_PASSPORT}/login` },
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()

    if (data.code !== 0) {
      throw { code: data.code, message: data.message }
    }

    return {
      url: data.data.url,
      qrcodeKey: data.data.qrcode_key,
    }
  })

  // 轮询二维码状态
  handle('bili:qrPoll', async (_event, qrcodeKey: string) => {
    const url = `${BILI_PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`
    const response = await authSession().fetch(url, {
      headers: { Referer: `${BILI_PASSPORT}/login` },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    })

    const setCookieHeaders = response.headers.getSetCookie?.() || []
    if (!setCookieHeaders.length) {
      const header = response.headers.get('set-cookie')
      if (header) setCookieHeaders.push(...header.split(/,(?=\s*[^;,=\s]+=)/))
    }
    let data: any
    try { data = JSON.parse(await response.text()) } catch {
      throw new Error('扫码状态响应无效，请重试')
    }
    if (data.code === 0 && data.data?.code === 0) await persistLoginCookies(setCookieHeaders, data.data.url)

    // B站 poll 响应：外层 code 表示 API 调用结果，
    // 内层 data.code 才是扫码状态（86101=未扫码, 86090=已扫码, 0=成功）
    return {
      code: data.code === 0 ? data.data?.code ?? -1 : data.code,
      status: data.code === 0 ? data.data?.code ?? -1 : data.code,
      message: data.data?.message || data.message,
      url: '',
    }
  })

  // 获取当前 Cookie 中的登录状态
  handle('bili:getLoginStatus', getLoginStatus)

  handle('bili:logout', async () => {
    for (const store of cookieStores()) {
      for (const cookie of await store.get({ domain: 'bilibili.com' })) {
        if (AUTH_COOKIE_NAMES.includes(cookie.name)) {
          await store.remove(`https://${(cookie.domain || '.bilibili.com').replace(/^\./, '')}${cookie.path || '/'}`, cookie.name)
        }
      }
      await store.flushStore()
    }
    cachedLogin = null
    return { success: true }
  })
}

// ===== BiliBili API Fetch Helper =====

const API_PATHS = new Set([
  '/x/web-interface/nav', '/x/web-interface/view', '/x/player/playurl',
  '/x/web-interface/search/type', '/x/web-interface/wbi/search/type', '/x/space/wbi/arc/search',
  '/x/web-interface/newlist', '/x/web-interface/popular', '/x/web-interface/index/top/rcmd', '/x/web-interface/ranking/region',
  '/x/v3/fav/folder/created/list-all', '/x/v2/reply',
  '/x/centralization/interface/music/comprehensive/web/rank', '/x/centralization/interface/new/music',
])
const authSession = () => session.fromPartition('persist:bili-auth')
const AUTH_COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']
const cookieStores = () => [session.defaultSession.cookies, authSession().cookies]
const persistentExpiry = () => Date.now() / 1000 + 180 * 86400
let cachedLogin: { isLogin: boolean; isLoggedIn: boolean; uid: string; uname: string; face: string } | null = null

async function writeCookie(cookie: Electron.CookiesSetDetails) {
  // Both stores must succeed before reporting QR success; values never cross IPC.
  for (const store of cookieStores()) await store.set(cookie)
}
async function flushCookies() {
  await Promise.all(cookieStores().map(store => store.flushStore()))
}
export async function initializeBiliAuth() {
  // Preserve both legacy/default and isolated credentials across upgrades/restarts.
  const merged = new Map<string, Electron.Cookie>()
  for (const store of cookieStores()) {
    for (const cookie of await store.get({ domain: 'bilibili.com' })) {
      merged.set(`${cookie.domain}:${cookie.path}:${cookie.name}`, cookie)
    }
  }
  for (const cookie of merged.values()) {
    await writeCookie({ ...cookie, url: `https://${(cookie.domain || '.bilibili.com').replace(/^\./, '')}${cookie.path || '/'}`,
      secure: true, httpOnly: true, expirationDate: cookie.expirationDate || persistentExpiry() })
  }
  await flushCookies()
}
async function persistLoginCookies(headers: string[], loginUrl?: string) {
  const parsed = new Map<string, Electron.CookiesSetDetails>()
  for (const header of headers) {
    const cookie = parseSetCookie(header)
    if (cookie?.name) parsed.set(cookie.name, cookie)
  }
  if (loginUrl) {
    const url = new URL(loginUrl)
    if (url.protocol === 'https:' && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))) {
      for (const name of AUTH_COOKIE_NAMES) {
        const value = url.searchParams.get(name)
        if (value && !parsed.has(name)) parsed.set(name, { url: BILI_API, domain: '.bilibili.com', path: '/', name, value,
          secure: true, httpOnly: true, expirationDate: persistentExpiry() })
      }
    }
  }
  // Chromium may have consumed Set-Cookie before JS can read the header.
  for (const cookie of await authSession().cookies.get({ url: BILI_API })) {
    if (!parsed.has(cookie.name)) parsed.set(cookie.name, { ...cookie, url: BILI_API,
      expirationDate: cookie.expirationDate || persistentExpiry() })
  }
  for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID']) {
    if (!parsed.get(name)?.value) throw new Error('扫码成功但登录凭据不完整，请刷新二维码重试')
  }
  for (const cookie of parsed.values()) await writeCookie(cookie)
  await flushCookies()
  cachedLogin = null
}
async function getLoginStatus() {
  const loggedOut = { isLogin: false, isLoggedIn: false, uid: '', uname: '', face: '' }
  const cookies = await authSession().cookies.get({ url: BILI_API })
  const uid = cookies.find(c => c.name === 'DedeUserID')?.value
  if (!uid || !cookies.some(c => c.name === 'SESSDATA' && c.value)) return loggedOut
  try {
    const response = await fetchBiliResponse('/x/web-interface/nav')
    if (response.code === -101 || (response.code === 0 && !response.data?.isLogin)) {
      cachedLogin = null
      return loggedOut
    }
    if (response.code !== 0) throw new Error(response.message || '登录状态暂不可用')
    const info = response.data
    cachedLogin = { isLogin: true, isLoggedIn: true, uid: String(info.mid || uid), uname: info.uname || '', face: info.face || '' }
    return cachedLogin
  } catch (error) {
    if (cachedLogin?.uid === uid) return cachedLogin
    throw error
  }
}

async function fetchBiliResponse(urlPath: string): Promise<any> {
  const response = await authSession().fetch(`${BILI_API}${urlPath}`, {
    headers: { Referer: BILI_REFERER, Origin: BILI_REFERER },
    signal: AbortSignal.timeout(20000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`B站请求失败 (${response.status})`)
  const data = await response.json()
  if (urlPath.split('?')[0] === '/x/web-interface/nav' && data.data) {
    const { isLogin, mid, uname, face, wbi_img } = data.data
    data.data = { isLogin, mid, uname, face, wbi_img }
  }
  return data
}
async function fetchBiliApi(urlPath: string): Promise<any> {
  const data = await fetchBiliResponse(urlPath)
  if (data.code !== 0) throw new Error(`B站请求失败 (${data.code}): ${data.message}`)
  return data.data
}

// ===== Cookie 解析辅助 =====

export function parseSetCookie(header: string): Electron.CookiesSetDetails | null {
  const [pair, ...parts] = header.split(';')
  const equals = pair.indexOf('=')
  if (equals < 1) return null
  const attrs = new Map(parts.map(part => {
    const [name, ...value] = part.trim().split('=')
    return [name.toLowerCase(), value.join('=')]
  }))
  const domain = attrs.get('domain') || '.bilibili.com'
  if (domain.replace(/^\./, '') !== 'bilibili.com') return null
  const maxAge = Number(attrs.get('max-age'))
  const expires = Date.parse(attrs.get('expires') || '') / 1000
  return { url: BILI_API, name: pair.slice(0, equals).trim(), value: pair.slice(equals + 1).trim(),
    domain, path: attrs.get('path') || '/', secure: true, httpOnly: true,
    expirationDate: attrs.has('max-age') && Number.isFinite(maxAge) ? Date.now() / 1000 + maxAge
      : Number.isFinite(expires) ? expires : persistentExpiry(),
    sameSite: attrs.get('samesite')?.toLowerCase() === 'strict' ? 'strict' : 'lax' }
}
