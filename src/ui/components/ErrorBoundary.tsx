import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import i18n from '@/i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const t = (key: string) => i18n.t(key)

      return (
        <div className="h-dvh bg-background text-foreground font-primary flex flex-col items-center justify-center p-6 pt-safe">
          <div className="flex flex-col items-center gap-4 text-center max-w-xs">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-title font-bold">
              !
            </div>
            <h1 className="text-title font-bold">{t('error.unexpectedTitle')}</h1>
            <p className="text-foreground-muted text-caption">{t('error.unexpectedMessage')}</p>
            <button
              onClick={this.handleReload}
              className="mt-4 px-5 py-3.5 bg-primary text-white rounded-xl font-semibold active:scale-95 transition-transform"
            >
              {t('error.reload')}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
