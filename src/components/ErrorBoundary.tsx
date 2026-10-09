import React, { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-secondary, #888)',
          textAlign: 'center',
          height: '100%',
        }}>
          <h2 style={{ fontSize: '18px', color: 'var(--color-text-primary, #fff)', marginBottom: '12px' }}>
            页面加载出现了一点问题
          </h2>
          <p style={{ fontSize: '13px', maxWidth: '400px', marginBottom: '20px', wordBreak: 'break-all' }}>
            {this.state.error?.message || '未知异常'}
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.hash = '#/'
            }}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              background: 'var(--color-primary, #ff6699)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            返回首页
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
