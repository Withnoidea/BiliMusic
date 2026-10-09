import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Loader2, Smartphone, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import QRCode from 'qrcode'
import { generateQrCode, pollQrCode } from '@/services/api'

type QrStatus = 'loading' | 'waiting' | 'scanned' | 'finalizing' | 'success' | 'expired' | 'error'

interface LoginDialogProps {
  onClose: () => void
  onSuccess: () => void
}

export default function LoginDialog({ onClose, onSuccess }: LoginDialogProps) {
  const [status, setStatus] = useState<QrStatus>('loading')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [countdown, setCountdown] = useState(180)
  const [errorMsg, setErrorMsg] = useState('')
  const [canRetryLogin, setCanRetryLogin] = useState(false)
  const retryLogin = useRef<() => void>(() => {})
  const expiresAt = useRef(0)
  const callbacks = useRef({ onClose, onSuccess })
  callbacks.current = { onClose, onSuccess }
  const generation = useRef(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  const generate = useCallback(async () => {
    const attempt = ++generation.current
    stopPolling()
    setStatus('loading')
    setErrorMsg('')
    setCanRetryLogin(false)
    setCountdown(180)
    try {
      const data = await generateQrCode()
      const dataUrl = await QRCode.toDataURL(data.url, {
        width: 200, margin: 2, color: { dark: '#18191C', light: '#FFFFFF' },
      })
      if (attempt !== generation.current) return
      expiresAt.current = Date.now() + 180_000
      setQrDataUrl(dataUrl)
      setStatus('waiting')
      let networkErrors = 0
      const poll = async () => {
        if (attempt !== generation.current) return
        try {
          const result = await pollQrCode(data.qrcodeKey)
          if (attempt !== generation.current) return
          networkErrors = 0
          const code = result.status ?? result.code
          if (code === 0) {
            ++generation.current
            stopPolling()
            setStatus('success')
            callbacks.current.onSuccess()
            callbacks.current.onClose()
            return
          }
          if (result.confirmed) {
            stopPolling()
            setStatus('error')
            setErrorMsg(result.message || '手机已确认，请重试完成登录')
            setCanRetryLogin(!!result.retryable)
            return
          }
          if (code === 86038) { ++generation.current; setStatus('expired'); stopPolling(); return }
          if (code === 86090) setStatus('scanned')
          else if (code === 86101) setStatus('waiting')
          else if (code !== 86101) {
            stopPolling()
            setStatus('error')
            setErrorMsg('扫码状态暂不可用，请刷新二维码后重试')
            return
          }
        } catch {
          if (attempt !== generation.current) return
          if (++networkErrors >= 3) {
            stopPolling()
            setStatus('error')
            setErrorMsg('连接登录服务失败，请检查网络后重试')
            // The main process may already hold a confirmed response; retry the
            // same attempt rather than silently losing it or calling it expired.
            setCanRetryLogin(true)
            return
          }
        }
        if (attempt === generation.current) pollTimerRef.current = setTimeout(poll, 2000)
      }
      retryLogin.current = () => {
        if (attempt !== generation.current) return
        stopPolling()
        networkErrors = 0
        setCanRetryLogin(false)
        setStatus('finalizing')
        void poll()
      }
      pollTimerRef.current = setTimeout(poll, 2000)
    } catch (e: any) {
      if (attempt !== generation.current) return
      setStatus('error')
      setErrorMsg(e.message || '生成二维码失败，请检查网络后重试')
    }
  }, [stopPolling])

  // 倒计时
  useEffect(() => {
    if (status !== 'waiting' && status !== 'scanned') return

    countdownRef.current = setInterval(() => {
      // Local time is only a hint. Only Bilibili's 86038 means expired; an
      // in-flight confirmation must not be cancelled when this reaches zero.
      setCountdown(Math.max(0, Math.ceil((expiresAt.current - Date.now()) / 1000)))
    }, 1000)

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [status, stopPolling])

  // 初始化生成二维码
  useEffect(() => {
    generate()
    return () => { ++generation.current; stopPolling() }
  }, [generate, stopPolling])

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="glass-panel-heavy"
        style={{
          width: 360,
          padding: 'var(--space-2xl)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-lg)',
          animation: 'fadeIn 250ms var(--easing-spring)',
        }}
      >
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="text-h2">BiliBili 扫码登录</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {/* QR Code Area */}
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: 'var(--radius-md)',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {(status === 'loading' || status === 'finalizing') && (
            <Loader2 size={32} style={{ color: 'var(--color-primary)', animation: 'spin 1s linear infinite' }} />
          )}

          {(status === 'waiting' || status === 'scanned') && qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="QR Code" style={{ width: 200, height: 200 }} />
              {status === 'scanned' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255,255,255,0.85)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Smartphone size={32} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-body" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                    扫码成功
                  </span>
                  <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
                    请在手机上确认登录
                  </span>
                </div>
              )}
            </>
          )}

          {status === 'success' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <CheckCircle2 size={40} style={{ color: '#52c41a' }} />
              <span className="text-body" style={{ color: '#52c41a', fontWeight: 600 }}>
                登录成功
              </span>
            </div>
          )}

          {(status === 'expired' || status === 'error') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
              {status === 'expired' ? (
                <>
                  <AlertCircle size={40} style={{ color: 'var(--color-muted)' }} />
                  <span className="text-body" style={{ color: 'var(--color-muted)' }}>
                    二维码已过期
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={40} style={{ color: 'var(--color-destructive)' }} />
                  <span className="text-caption" style={{ color: 'var(--color-destructive)', textAlign: 'center' }}>
                    {errorMsg || '生成二维码失败'}
                  </span>
                </>
              )}
              <button
                onClick={canRetryLogin ? () => retryLogin.current() : generate}
                style={{
                  marginTop: 4,
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-primary)',
                  color: 'var(--color-on-primary)',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <RefreshCw size={14} />
                {canRetryLogin ? '重试完成登录' : '刷新二维码'}
              </button>
              {canRetryLogin && <button onClick={generate} style={{ border: 'none', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', fontSize: 12 }}>重新生成二维码</button>}
            </div>
          )}
        </div>

        {status === 'finalizing' && <p className="text-caption" role="status">正在完成登录，请稍候…</p>}
        {status === 'waiting' && (
          <div style={{ textAlign: 'center' }}>
            <p className="text-body" style={{ color: 'var(--color-foreground)' }}>
              请使用 BiliBili App 扫码登录
            </p>
            <p className="text-caption" style={{ color: 'var(--color-muted)', marginTop: 4 }}>
              二维码有效期 {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
            </p>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-muted)' }}>
          <span className="text-caption">打开 BiliBili App → 我的 → 扫一扫</span>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
