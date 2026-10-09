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
      credentials: 'include',
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

  // A confirmed key is single-use. Retries must finalize the saved response, not poll it again.
  handle('bili:qrPoll', (_event, qrcodeKey: string) => pollQrLogin(qrcodeKey))

  // 获取当前 Cookie 中的登录状态
  handle('bili:getLoginStatus', getLoginStatus)

  handle('bili:logout', async () => {
    qrAttempts.clear()
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
  '/x/web-interface/archive/related', '/x/polymer/web-dynamic/v1/feed/all',
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

interface QrResult {
  code: number
  status: number
  message: string
  url: string
  confirmed?: boolean
  retryable?: boolean
}
interface QrAttempt {
  createdAt: number
  confirmed?: { headers: string[]; url?: string }
  inFlight?: Promise<QrResult>
  result?: QrResult
}
const qrAttempts = new Map<string, QrAttempt>()

// Electron 36 net-fetch joins response header arrays with ", ". getSetCookie()
// consequently can return ONE entry containing several cookies. Split EVERY entry,
// but never the comma in an Expires date (there is no cookie-name= after that comma).
export function splitSetCookieHeaders(headers: string[]): string[] {
  return headers.flatMap(header => header.split(/,(?=\s*[^;,=\s]+=)/).map(value => value.trim()))
}
function responseCookies(response: Response) {
  const values = response.headers.getSetCookie?.() || []
  return splitSetCookieHeaders(values.length ? values : [response.headers.get('set-cookie') || ''])
}
async function pollQrLogin(key: string): Promise<QrResult> {
  if (typeof key !== 'string' || !key || key.length > 512) throw new Error('无效的二维码')
  for (const [id, attempt] of qrAttempts) {
    if (!attempt.inFlight && Date.now() - attempt.createdAt > 10 * 60_000) qrAttempts.delete(id)
  }
  let attempt = qrAttempts.get(key)
  if (!attempt) {
    if (qrAttempts.size >= 32) throw new Error('二维码请求过多，请稍后重试')
    attempt = { createdAt: Date.now() }
    qrAttempts.set(key, attempt)
  }
  if (attempt.result) return attempt.result
  if (attempt.inFlight) return attempt.inFlight
  const task = processQrAttempt(key, attempt)
  attempt.inFlight = task
  try { return await task } finally { attempt.inFlight = undefined }
}
async function processQrAttempt(key: string, attempt: QrAttempt): Promise<QrResult> {
  if (!attempt.confirmed) {
    const response = await authSession().fetch(`${BILI_PASSPORT}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`, {
      headers: { Referer: `${BILI_PASSPORT}/login` }, credentials: 'include',
      signal: AbortSignal.timeout(15000), redirect: 'error',
    })
    if (!response.ok) throw new Error(`扫码状态请求失败 (${response.status})`)
    let data: any
    try { data = await response.json() } catch { throw new Error('扫码状态响应无效，请重试') }
    const code = data.code === 0 ? data.data?.code ?? -1 : data.code
    if (code !== 0) return { code, status: code, message: data.data?.message || data.message || '', url: '' }
    // Remember success BEFORE any cookie write, flush or nav request can fail.
    attempt.confirmed = { headers: responseCookies(response), url: data.data?.url }
  }
  let stage: 'cookies' | 'verification' = 'cookies'
  try {
    await persistLoginCookies(attempt.confirmed.headers, attempt.confirmed.url)
    stage = 'verification'
    const user = await getLoginStatus()
    if (!user.isLogin) throw new Error('登录状态未生效')
    const result = { code: 0, status: 0, message: '登录成功', url: '', confirmed: true }
    attempt.result = result
    // Credentials remain exclusively in the cookie stores after completion.
    attempt.confirmed = undefined
    return result
  } catch {
    // Never expose Chromium error text (it can contain cookie values) across IPC.
    return { code: -2, status: -2, confirmed: true, retryable: true, url: '',
      message: stage === 'cookies'
        ? '手机已确认，但登录凭据保存未完成。请重试完成登录，无需再次扫码。'
        : '手机已确认，登录凭据已保存，但暂时无法验证账号。请检查网络后重试完成登录。' }
  }
}

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
  for (const header of splitSetCookieHeaders(headers)) {
    const cookie = parseSetCookie(header)
    if (cookie?.name && AUTH_COOKIE_NAMES.includes(cookie.name)) parsed.set(cookie.name, cookie)
  }
  if (loginUrl) {
    // Older passport responses contain an http callback. Never navigate to it;
    // only read allowlisted credential fields locally, preserving percent encoding.
    try {
      const url = new URL(loginUrl)
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))) {
        for (const pair of url.search.slice(1).split('&')) {
          const equals = pair.indexOf('=')
          const name = pair.slice(0, equals)
          const value = pair.slice(equals + 1)
          if (equals > 0 && AUTH_COOKIE_NAMES.includes(name) && value && !parsed.has(name)) {
            parsed.set(name, { url: BILI_API, domain: '.bilibili.com', path: '/', name, value,
              secure: true, httpOnly: true, expirationDate: persistentExpiry() })
          }
        }
      }
    } catch { /* An optional malformed callback must not discard valid Set-Cookie. */ }
  }
  // Chromium may have consumed Set-Cookie before JS can read the header.
  const existing = await authSession().cookies.get({ url: BILI_API })
  const incomingUid = parsed.get('DedeUserID')?.value
  const existingUid = existing.find(cookie => cookie.name === 'DedeUserID')?.value
  for (const cookie of existing) {
    if (incomingUid && existingUid && incomingUid !== existingUid) continue
    if (AUTH_COOKIE_NAMES.includes(cookie.name) && !parsed.has(cookie.name)) parsed.set(cookie.name, { ...cookie, url: BILI_API,
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
    credentials: 'include',
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
