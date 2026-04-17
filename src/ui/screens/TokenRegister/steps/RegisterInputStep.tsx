import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Camera, Clipboard } from 'lucide-react'
import { useState } from 'react'

export type MockPath = 'trusted-memo' | 'trusted-no-memo' | 'untrusted'

export interface RegisterInputStepProps {
  onBack: () => void
  onNext: (path: MockPath) => void
  initialToken: string
  initialPath: MockPath
}

const PATH_LABEL: Record<MockPath, string> = {
  'trusted-memo': 'Trusted · 메모 있음',
  'trusted-no-memo': 'Trusted · 메모 없음',
  untrusted: 'Untrusted',
}

export function RegisterInputStep({
  onBack,
  onNext,
  initialToken,
  initialPath,
}: RegisterInputStepProps) {
  const [token, setToken] = useState(initialToken)
  const [path, setPath] = useState<MockPath>(initialPath)

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="토큰 등록하기" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <h2 className="text-heading font-semibold text-foreground leading-snug">
          토큰을 붙여넣거나 스캔해서
          <br />
          등록할 수 있어요.
        </h2>
        <p className="text-body text-foreground-muted mt-3">
          토큰은 <span className="font-semibold text-foreground">cashuB</span> 로 시작하는 문자열이에요.
        </p>

        {/* Token input — underline style */}
        <div className="mt-8">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="토큰 입력"
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Paste / Scan chips */}
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 px-4 h-10 rounded-full bg-background-card text-foreground hover:bg-background-hover transition-colors"
          >
            <Clipboard className="w-4 h-4" strokeWidth={1.8} />
            <span className="text-body">붙여넣기</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-4 h-10 rounded-full bg-background-card text-foreground hover:bg-background-hover transition-colors"
          >
            <Camera className="w-4 h-4" strokeWidth={1.8} />
            <span className="text-body">스캔하기</span>
          </button>
        </div>

        {/* Mock path toggle — placeholder only */}
        <div className="mt-10 p-3 rounded-card bg-background-card">
          <p className="text-caption text-foreground-muted mb-2">
            [mock] 다음 화면 선택
          </p>
          <div className="flex flex-col gap-1.5">
            {(Object.keys(PATH_LABEL) as MockPath[]).map((p) => (
              <label
                key={p}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="mock-path"
                  value={p}
                  checked={path === p}
                  onChange={() => setPath(p)}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-body text-foreground">{PATH_LABEL[p]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <BottomActionBar extraBottom={16} gap="none" className="px-6">
        <Button
          variant="brand"
          size="xl"
          onClick={() => onNext(path)}
          className="w-full"
        >
          다음
        </Button>
      </BottomActionBar>
    </div>
  )
}
