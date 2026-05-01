// cs-screens-1.jsx — Home, Compose, Inquiry/Idea List screens

const inputStyle = {
  width: "100%", padding: "12px 14px", marginTop: 8,
  background: csStyles.surface, border: `1px solid ${csStyles.hairline}`,
  borderRadius: 12, fontSize: 14, color: csStyles.ink1,
  fontFamily: "var(--zt-font-ui)", letterSpacing: "-0.005em",
  outline: "none", boxSizing: "border-box",
};
function FieldLabel({ children, style }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: csStyles.ink2, letterSpacing: "-0.005em", ...style }}>{children}</div>;
}
function Req() { return <span style={{ color: csStyles.accent, marginLeft: 2 }}>*</span>; }

function ActionRow({ icon, title, subtitle, onClick, badge, accent }) {
  return (
    <div onClick={onClick} style={{
      background: csStyles.surface, border: `1px solid ${csStyles.hairline}`,
      borderRadius: 16, padding: "16px 18px",
      display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: accent || csStyles.accentSoft,
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: csStyles.ink1, letterSpacing: "-0.01em" }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#fff",
              background: csStyles.accent, borderRadius: 999,
              padding: "2px 6px", lineHeight: 1, minWidth: 16, textAlign: "center",
            }}>{badge}</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: csStyles.ink3, marginTop: 3, letterSpacing: "-0.005em" }}>{subtitle}</div>
      </div>
      <CSIcon.chevron />
    </div>
  );
}

function FAB({ onClick, label }) {
  return (
    <button onClick={onClick} style={{
      position: "absolute", right: 18, bottom: 26,
      height: 50, padding: "0 20px 0 16px", borderRadius: 999,
      background: csStyles.accent, color: "#fff",
      border: "none", cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      fontFamily: "var(--zt-font-ui)", fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em",
      boxShadow: "0 8px 22px -4px rgba(81,90,192,0.55), 0 2px 4px rgba(15,23,42,0.08)",
    }}><CSIcon.plus size={18} />{label}</button>
  );
}

// ── HelpHomeScreen ────────────────────────────────────────────────────────────
function HelpHomeScreen({ go }) {
  const faqs = [
    "라이트닝 결제가 실패해요",
    "이캐시 토큰이 등록되지 않아요",
    "수수료는 어떻게 결정되나요?",
    "지갑 백업은 어떻게 하나요?",
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", paddingBottom: 32 }}>
      <Header onBack={() => {}} title="무엇을 도와드릴까요?" subtitle="궁금한 점은 언제든 편하게 물어보세요." />

      <div style={{ padding: "0 20px 18px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: csStyles.surface, border: `1px solid ${csStyles.hairline}`,
          borderRadius: 14, padding: "12px 14px",
        }}>
          <CSIcon.search />
          <span style={{ flex: 1, fontSize: 14, color: csStyles.ink4, letterSpacing: "-0.005em" }}>키워드로 검색해 보세요</span>
        </div>
      </div>

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: csStyles.ink3, letterSpacing: "-0.005em" }}>자주 묻는 질문</span>
          <span style={{ fontSize: 12, color: csStyles.ink4, fontWeight: 500 }}>전체 보기 →</span>
        </div>
        <Card padding={0}>
          {faqs.map((q, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px",
              borderTop: i === 0 ? "none" : `1px solid ${csStyles.hairlineSoft}`,
              cursor: "pointer",
            }}>
              <span style={{ fontSize: 14, color: csStyles.ink1, letterSpacing: "-0.005em" }}>{q}</span>
              <CSIcon.chevron />
            </div>
          ))}
        </Card>
      </div>

      <div style={{ padding: "4px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <ActionRow icon={<CSIcon.message />} title="새로운 문의 작성하기"
          subtitle="담당 직원이 직접 답변해드려요" onClick={() => go("compose-inquiry")} />
        <ActionRow icon={<CSIcon.inbox />} title="문의 내역 확인하기"
          subtitle="총 3 건 · 새 답변 1 건이 도착했어요" badge="1" onClick={() => go("inquiry-list")} />
        <div style={{ height: 6 }} />
        <ActionRow icon={<CSIcon.bulb color={csStyles.pendingInk} />} accent={csStyles.pendingSoft}
          title="아이디어 제안하기" subtitle="째피팀에게 의견을 들려주세요"
          onClick={() => go("compose-idea")} />
        <ActionRow icon={<CSIcon.spark color={csStyles.ink2} />} accent="#F0F2F7"
          title="제안 내역 보기" subtitle="총 2 건의 보낸 제안"
          onClick={() => go("idea-list")} />
      </div>

      <div style={{ padding: "22px 20px 0", textAlign: "center", fontSize: 11, color: csStyles.ink4 }}>
        평일 10:00 – 18:00 · 평균 응답 시간 4시간 이내
      </div>
    </div>
  );
}

// ── ComposeScreen ─────────────────────────────────────────────────────────────
function ComposeScreen({ go, kind = "inquiry" }) {
  const isIdea = kind === "idea";
  const [title, setTitle] = React.useState("");
  const [body, setBody]   = React.useState("");
  const [cat, setCat]     = React.useState("");
  const [files, setFiles] = React.useState([]);

  const categories = isIdea
    ? ["UI / UX 개선", "신규 기능", "성능 / 안정성", "기타"]
    : ["송수신 관련", "이캐시 관련", "수수료 관련", "보안 / 백업", "기타"];

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Header onBack={() => go(isIdea ? "idea-list" : "home")}
          title={isIdea ? "새로운 제안 작성하기" : "새로운 문의 작성하기"}
          subtitle={isIdea
            ? "어떤 점이 더 좋아질 수 있을까요? 째피팀이 꼼꼼히 읽어볼게요."
            : "도움이 필요한 내용을 자세히 설명해주세요. 담당 직원이 빠른 시일 내에 답변드려요."} />

        <div style={{ padding: "0 20px 16px" }}>
          <FieldLabel>제목 <Req/></FieldLabel>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={isIdea ? "한 줄로 요약해 주세요" : "어떤 문제가 있는지 짧게 적어주세요"}
            style={inputStyle} />

          <FieldLabel style={{ marginTop: 18 }}>카테고리 <Req/></FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {categories.map((c) => (
              <button key={c} onClick={() => setCat(c)} style={{
                border: cat === c ? `1px solid ${csStyles.accent}` : `1px solid ${csStyles.hairline}`,
                background: cat === c ? csStyles.accentSoft : csStyles.surface,
                color: cat === c ? csStyles.accent : csStyles.ink2,
                fontSize: 12, fontWeight: cat === c ? 600 : 500,
                borderRadius: 999, padding: "8px 14px",
                cursor: "pointer", letterSpacing: "-0.005em",
                fontFamily: "var(--zt-font-ui)",
              }}>{c}</button>
            ))}
          </div>

          <FieldLabel style={{ marginTop: 18 }}>{isIdea ? "제안 내용" : "문의 내용"} <Req/></FieldLabel>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={isIdea
              ? "어떤 상황에서 어떤 점이 아쉬웠는지, 어떻게 바뀌면 좋을지 자유롭게 적어 주세요."
              : "상세한 내용을 적어주세요. 관련 데이터나 스크린샷을 포함하면 문제 해결 가능성이 높아져요."}
            style={{ ...inputStyle, minHeight: 130, resize: "none", lineHeight: 1.55, fontFamily: "var(--zt-font-ui)" }} />
          <div style={{ fontSize: 11, color: csStyles.ink4, textAlign: "right", marginTop: 4 }}>{body.length} / 2000</div>

          {!isIdea && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              background: csStyles.accentSoft, borderRadius: 10,
              padding: "10px 12px", marginTop: 10,
            }}>
              <div style={{ marginTop: 1, flexShrink: 0 }}><CSIcon.shield /></div>
              <div style={{ fontSize: 11.5, color: csStyles.ink2, lineHeight: 1.5, letterSpacing: "-0.005em" }}>
                <strong>니모닉 문구와 PIN 번호는 절대 입력하지 마세요.</strong> 째피는 어떤 경우에도 사용자의 개인키 정보를 요구하지 않습니다.
              </div>
            </div>
          )}

          <FieldLabel style={{ marginTop: 18 }}>파일 첨부</FieldLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                background: csStyles.surface, border: `1px solid ${csStyles.hairline}`,
                borderRadius: 10, padding: "8px 10px 8px 12px",
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: csStyles.accentSoft,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <CSIcon.imageFile color={csStyles.accent} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: csStyles.ink1, letterSpacing: "-0.005em" }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: csStyles.ink4, marginTop: 1 }}>{f.size}</div>
                </div>
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{
                  width: 24, height: 24, borderRadius: 999, background: "#F2F4F9",
                  border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0,
                }}><CSIcon.x size={12} /></button>
              </div>
            ))}
            <button onClick={() => setFiles([...files, { name: `스크린샷0${files.length + 1}.png`, size: "1.2MB" }])}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: csStyles.surface, border: `1px dashed ${csStyles.hairline}`,
                borderRadius: 12, padding: "12px",
                color: csStyles.ink3, fontSize: 13, fontWeight: 500,
                cursor: "pointer", letterSpacing: "-0.005em", fontFamily: "var(--zt-font-ui)",
              }}>
              <CSIcon.paperclip />파일 첨부하기
            </button>
          </div>

          <div style={{ fontSize: 11, color: csStyles.ink4, marginTop: 14, textAlign: "center", letterSpacing: "-0.005em" }}>
            모든 내용은 암호화되어 안전하게 전송됩니다.
          </div>
        </div>
      </div>

      <div style={{
        padding: "12px 20px 28px", background: csStyles.surface,
        borderTop: `1px solid ${csStyles.hairline}`,
      }}>
        <button onClick={() => go(isIdea ? "idea-list" : "inquiry-list")} style={{
          width: "100%", height: 50,
          background: csStyles.accent, color: "#fff",
          border: "none", borderRadius: 14,
          fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em",
          cursor: "pointer", fontFamily: "var(--zt-font-ui)",
          boxShadow: "0 4px 12px -4px rgba(81,90,192,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <CSIcon.send />{isIdea ? "제안 보내기" : "문의 보내기"}
        </button>
      </div>
    </div>
  );
}

// ── InquiryListScreen ─────────────────────────────────────────────────────────
function InquiryListScreen({ go }) {
  const items = [
    { id: 1, title: "라이트닝 결제 오류 문의",   cat: "송수신 관련",  time: "2026-04-28 16:40", status: "answered", unread: true },
    { id: 2, title: "이캐시 전송 실패 관련 문의", cat: "이캐시 관련",  time: "2026-04-26 11:08", status: "progress" },
    { id: 3, title: "거래내역이 사라졌어요",     cat: "보안 / 백업",  time: "2026-04-22 09:24", status: "received" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", paddingBottom: 96 }}>
      <Header onBack={() => go("home")} title="내 문의 내역" subtitle="총 3 건의 접수된 문의가 있어요." />
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it) => (
          <Card key={it.id} onClick={() => go("inquiry-detail")}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <StatusChip kind={it.status} />
              {it.unread && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: csStyles.accent,
                  background: csStyles.accentSoft, padding: "3px 8px",
                  borderRadius: 999, letterSpacing: "-0.005em",
                }}>NEW</span>
              )}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: csStyles.ink1, marginTop: 12, letterSpacing: "-0.01em" }}>{it.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: csStyles.ink3 }}>{it.cat}</span>
              <span style={{ width: 2, height: 2, borderRadius: "50%", background: csStyles.ink4 }} />
              <span style={{ fontSize: 12, color: csStyles.ink4 }}>{it.time}</span>
            </div>
          </Card>
        ))}
      </div>
      <FAB onClick={() => go("compose-inquiry")} label="새 문의" />
    </div>
  );
}

// ── IdeaListScreen ────────────────────────────────────────────────────────────
function IdeaListScreen({ go }) {
  const items = [
    { id: 1, title: "QR 스캔 후 자동 카테고리 분류", cat: "UI / UX 개선", time: "2026-04-28 16:40" },
    { id: 2, title: "위젯에서 잔액 빠르게 확인하기",  cat: "신규 기능",     time: "2026-04-20 09:05" },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", paddingBottom: 96 }}>
      <Header onBack={() => go("home")} title="아이디어 제안 내역" subtitle="총 2 건의 보낸 제안이 있어요." />
      <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it) => (
          <Card key={it.id} onClick={() => go("idea-detail")}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CSIcon.spark size={14} color={csStyles.accent} />
              <span style={{ fontSize: 11, fontWeight: 600, color: csStyles.accent, letterSpacing: "0.02em" }}>제안</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: csStyles.ink1, marginTop: 10, letterSpacing: "-0.01em" }}>{it.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: csStyles.ink3 }}>{it.cat}</span>
              <span style={{ width: 2, height: 2, borderRadius: "50%", background: csStyles.ink4 }} />
              <span style={{ fontSize: 12, color: csStyles.ink4 }}>{it.time}</span>
            </div>
          </Card>
        ))}
      </div>
      <FAB onClick={() => go("compose-idea")} label="새 제안" />
    </div>
  );
}

Object.assign(window, {
  HelpHomeScreen, ComposeScreen, InquiryListScreen, IdeaListScreen, FAB,
});
