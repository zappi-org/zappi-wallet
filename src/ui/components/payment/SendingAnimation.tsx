/**
 * Sending Animation — Running star character
 */

interface SendingAnimationProps {
  className?: string
  scale?: number
}

export function SendingAnimation({ className = '', scale = 1 }: SendingAnimationProps) {
  const size = Math.round(240 * scale)

  return (
    <div className={className} style={{ width: size, height: size }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%">
        <defs>
          <style>{`
            .za-character { animation: za-bounce 0.5s infinite ease-in-out; }
            .za-leg1 { animation: za-run-leg1 0.5s infinite ease-in-out; transform-origin: 200px 320px; }
            .za-leg2 { animation: za-run-leg2 0.5s infinite ease-in-out; transform-origin: 300px 320px; }
            .za-dust { animation: za-dust-puff 0.5s infinite ease-out; transform-origin: 100px 390px; }
            .za-speed-line { stroke: #123c8a; stroke-width: 4; stroke-linecap: round; animation: za-wind 0.4s infinite ease-in-out alternate; }
            .za-sl-1 { animation-delay: 0s; }
            .za-sl-2 { animation-delay: 0.2s; }
            .za-sl-3 { animation-delay: 0.1s; }
            @keyframes za-bounce { 0%, 50%, 100% { transform: translateY(0); } 25%, 75% { transform: translateY(-20px); } }
            @keyframes za-run-leg1 { 0%, 100% { transform: rotate(40deg); } 50% { transform: rotate(-40deg); } }
            @keyframes za-run-leg2 { 0%, 100% { transform: rotate(-40deg); } 50% { transform: rotate(40deg); } }
            @keyframes za-dust-puff { 0% { transform: scale(0.6) translateX(20px); opacity: 0; } 30% { opacity: 1; } 100% { transform: scale(1.2) translateX(-60px); opacity: 0; } }
            @keyframes za-wind { 0% { transform: scaleX(1) translateX(0); opacity: 0.5; } 100% { transform: scaleX(1.4) translateX(-15px); opacity: 1; } }
          `}</style>
        </defs>

        <g className="za-speed-line za-sl-1">
          <line x1="80" y1="180" x2="150" y2="160" />
          <line x1="100" y1="200" x2="140" y2="190" />
        </g>
        <g className="za-speed-line za-sl-2">
          <line x1="60" y1="300" x2="160" y2="270" />
          <line x1="80" y1="320" x2="130" y2="305" />
        </g>
        <g className="za-speed-line za-sl-3">
          <line x1="320" y1="430" x2="400" y2="400" />
          <line x1="340" y1="450" x2="390" y2="430" />
        </g>

        <g className="za-dust" fill="#185adb">
          <circle cx="80" cy="380" r="20" />
          <circle cx="50" cy="390" r="15" />
          <circle cx="110" cy="390" r="15" />
          <path d="M 110 390 L 160 410 L 50 410 Z" />
        </g>

        <g className="za-character">
          <path className="za-leg2" d="M 300 320 Q 300 380 300 400 L 260 400" fill="none" stroke="#185adb" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
          <path className="za-leg1" d="M 200 320 Q 200 380 200 400 L 160 400" fill="none" stroke="#185adb" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M 250 120 L 280 180 L 370 150 L 330 220 L 400 290 L 320 310 L 310 380 L 260 330 L 180 380 L 190 300 L 100 280 L 160 220 L 130 140 L 210 170 Z" fill="#185adb" stroke="#185adb" strokeWidth="30" strokeLinejoin="round" />
          <ellipse cx="230" cy="240" rx="8" ry="12" fill="#fbd2c2" />
          <ellipse cx="270" cy="240" rx="8" ry="12" fill="#fbd2c2" />
          <path d="M 235 270 Q 250 295 265 270" stroke="#fbd2c2" strokeWidth="10" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </div>
  )
}
