// cs-components.jsx — Shared primitives for Zappi CS system
// Sharper, more refined feel than the wireframe — tighter radii, hairlines, generous whitespace.

const csStyles = {
  // Hex tokens for inline use
  bg: "#F7F8FB",
  surface: "#FFFFFF",
  hairline: "#EAECF2",
  hairlineSoft: "#F0F2F7",
  ink1: "#0F172A",       // titles
  ink2: "#1E2250",       // body / brand
  ink3: "#5B6478",       // secondary
  ink4: "#8A92A6",       // tertiary
  accent: "#515AC0",     // brand indigo
  accentSoft: "#EEF0FB", // indigo wash
  warn: "#F9C416",
  ok: "#22A06B",
  okSoft: "#E6F4EE",
  pendingSoft: "#FFF6DC",
  pendingInk: "#9A6B00",
  danger: "#C45D3E",
};

// ─── Icon set — simple, sharp, 1.6 stroke ──────────────────────────────────────
const CSIcon = {
  back: ({ size = 22, color = csStyles.ink1 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevron: ({ size = 16, color = csStyles.ink4 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  search: ({ size = 18, color = csStyles.ink3 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  faq: ({ size = 22, color = csStyles.ink2 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.6c0 1.5-2.4 2-2.4 3.4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  message: ({ size = 22, color = csStyles.ink2 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 1 1-3.5-6.6L21 5l-.6 3.5A8 8 0 0 1 21 12z" />
      <path d="M8 11h8M8 14h5" />
    </svg>
  ),
  inbox: ({ size = 22, color = csStyles.ink2 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5" />
      <path d="M3 13l2.5-7.2A2 2 0 0 1 7.4 4.5h9.2a2 2 0 0 1 1.9 1.3L21 13" />
      <path d="M3 13h4l1.5 2.5h7L17 13h4" />
    </svg>
  ),
  bulb: ({ size = 22, color = csStyles.ink2 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1.3 1.6 1.5 2.5h5c.2-.9.7-1.7 1.5-2.5A6 6 0 0 0 12 3z" />
    </svg>
  ),
  paperclip: ({ size = 18, color = csStyles.ink3 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-2.8-2.8L14 8" />
    </svg>
  ),
  send: ({ size = 16, color = "#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  plus: ({ size = 18, color = "#fff" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  shield: ({ size = 14, color = csStyles.accent }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="m9.5 12 2 2 3.5-4" />
    </svg>
  ),
  check: ({ size = 14, color = csStyles.ok }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  imageFile: ({ size = 18, color = csStyles.ink3 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M21 15l-5-5-9 9" />
    </svg>
  ),
  x: ({ size = 14, color = csStyles.ink3 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  caret: ({ size = 14, color = csStyles.ink3, dir = "down" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: dir === "up" ? "rotate(180deg)" : "none" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  spark: ({ size = 16, color = csStyles.accent }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  ),
  dot: ({ size = 6, color = csStyles.warn }) => (
    <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color }} />
  ),
};

// ─── Phone shell ─────────────────────────────────────────────────────────────
function Phone({ children, label }) {
  return (
    <div data-screen-label={label} style={{
      width: 390, height: 844, position: "relative",
      background: csStyles.bg, borderRadius: 44, overflow: "hidden",
      boxShadow: "0 24px 60px -20px rgba(15,23,42,0.18), 0 1px 3px rgba(15,23,42,0.06), inset 0 0 0 1px rgba(15,23,42,0.06)",
      fontFamily: "var(--zt-font-ui)",
      color: csStyles.ink2,
    }}>
      {/* status bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 44, zIndex: 5,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "16px 28px 0",
        fontFamily: "var(--zt-font-ui)", fontWeight: 600, fontSize: 14, color: csStyles.ink1,
        pointerEvents: "none",
      }}>
        <span>9:41</span>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <svg width="16" height="10" viewBox="0 0 16 10"><rect x="0" y="6" width="3" height="4" rx="0.6" fill={csStyles.ink1}/><rect x="4.5" y="4" width="3" height="6" rx="0.6" fill={csStyles.ink1}/><rect x="9" y="2" width="3" height="8" rx="0.6" fill={csStyles.ink1}/><rect x="13.5" y="0" width="3" height="10" rx="0.6" fill={csStyles.ink1}/></svg>
          <svg width="22" height="11" viewBox="0 0 22 11"><rect x="0.5" y="0.5" width="19" height="10" rx="3" stroke={csStyles.ink1} strokeOpacity="0.5" fill="none"/><rect x="2" y="2" width="16" height="7" rx="1.5" fill={csStyles.ink1}/></svg>
        </div>
      </div>
      {children}
      {/* home indicator */}
      <div style={{
        position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
        width: 134, height: 5, borderRadius: 100, background: "rgba(15,23,42,0.28)",
      }} />
    </div>
  );
}

// ─── Screen header (back + title) ────────────────────────────────────────────
// meta: 제목 위에 왼쪽 정렬된 칩들 (상태/카테고리 등 — 가장 중요한 것을 먼저)
// right: 헤더 오른쪽 상단 보조 슬롯 (선택)
function Header({ onBack, title, subtitle, right, meta }) {
  return (
    <div style={{
      paddingTop: 56, paddingLeft: 20, paddingRight: 20, paddingBottom: 18,
      background: csStyles.bg,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 32, marginBottom: 14 }}>
        <button onClick={onBack} style={{
          width: 32, height: 32, border: "none", background: "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0, marginLeft: -6,
        }}>
          <CSIcon.back />
        </button>
        {right}
      </div>
      {meta && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 10 }}>
          {meta}
        </div>
      )}
      <div style={{ fontSize: 22, fontWeight: 700, color: csStyles.ink1, lineHeight: 1.2, letterSpacing: "-0.01em" }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 6, fontSize: 13, color: csStyles.ink3, lineHeight: 1.5, letterSpacing: "-0.005em" }}>{subtitle}</div>
      )}
    </div>
  );
}

// ─── Category chip — 사용자가 보낼 때 선택한 카테고리 표시 ─────────────────
function CategoryChip({ label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "4px 10px", borderRadius: 999,
      background: csStyles.surface,
      border: `1px solid ${csStyles.hairline}`,
      color: csStyles.ink2,
      fontSize: 11, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1,
    }}>
      {label}
    </span>
  );
}

// ─── Status chip — 접수됨 → 진행중 → 상담 완료 (차분 톤) ─────────────
// 접수됨:   슬레이트 그레이 (조용히 대기)
// 진행중:   인디고 (브랜드 액센트, 액티브)
// 상담완료: 채도 낮은 슬레이트 (시각적으로 후퇴, 끝났음)
function StatusChip({ kind = "received" }) {
  const map = {
    received: { label: "접수됨",    bg: "#F0F2F7",            fg: "#5B6478",       dot: "#8A92A6" },
    progress: { label: "진행중",    bg: csStyles.accentSoft,  fg: csStyles.accent, dot: csStyles.accent },
    answered: { label: "상담 완료", bg: "#F7F8FB",            fg: "#8A92A6",       dot: "#B3B9C9" },
    closed:   { label: "종료",     bg: "#F0F2F7",             fg: csStyles.ink3,   dot: csStyles.ink4 },
  };
  const c = map[kind];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px 4px 8px", borderRadius: 999,
      background: c.bg, color: c.fg,
      fontSize: 11, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, display: "inline-block" }} />
      {c.label}
    </span>
  );
}

// ─── Card (white, hairline, refined) ───────────────────────────────────────
function Card({ children, onClick, style, padding = 16 }) {
  return (
    <div onClick={onClick} style={{
      background: csStyles.surface,
      border: `1px solid ${csStyles.hairline}`,
      borderRadius: 16,
      padding,
      cursor: onClick ? "pointer" : "default",
      transition: "transform 140ms cubic-bezier(0.22,0.61,0.36,1), box-shadow 140ms cubic-bezier(0.22,0.61,0.36,1)",
      ...style,
    }}
    onMouseDown={(e) => onClick && (e.currentTarget.style.transform = "scale(0.99)")}
    onMouseUp={(e) => onClick && (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={(e) => onClick && (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </div>
  );
}

Object.assign(window, { csStyles, CSIcon, Phone, Header, StatusChip, CategoryChip, Card });
