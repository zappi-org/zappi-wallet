// cs-screens-2.jsx — Detail screens with chat thread

function ThreadMessage({ role, time, body, files, role2 }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {!isUser && (
          <div style={{
            width: 22, height: 22, borderRadius: 999, background: csStyles.accent, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, letterSpacing: "-0.005em",
          }}>Z</div>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, color: csStyles.ink2, letterSpacing: "-0.005em" }}>
          {isUser ? "내가 보낸 문의" : "째피 고객지원팀"}
        </span>
        <span style={{ fontSize: 11, color: csStyles.ink4 }}>· {time}</span>
      </div>
      <div style={{
        maxWidth: 280, padding: "12px 14px",
        background: isUser ? csStyles.surface : csStyles.accentSoft,
        border: `1px solid ${isUser ? csStyles.hairline : "transparent"}`,
        borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        fontSize: 13.5, lineHeight: 1.6, color: csStyles.ink1, letterSpacing: "-0.005em",
        whiteSpace: "pre-wrap",
      }}>
        {body}
        {files && files.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", background: "#fff",
                border: `1px solid ${csStyles.hairline}`, borderRadius: 8,
              }}>
                <CSIcon.imageFile size={14} color={csStyles.ink3} />
                <span style={{ flex: 1, fontSize: 11.5, color: csStyles.ink2, letterSpacing: "-0.005em" }}>{f.name}</span>
                <span style={{ fontSize: 10.5, color: csStyles.ink4 }}>{f.size}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── InquiryDetailScreen ──────────────────────────────────────────────────────
function InquiryDetailScreen({ go }) {
  const [draft, setDraft] = React.useState("");
  const [thread, setThread] = React.useState([
    { role: "user", time: "04-28 16:40",
      body: "안녕하세요. 현재 최신 버전의 째피를 사용하고 있습니다. 보내기를 시도했는데 제 잔고는 줄었지만 상대방이 아직 받지 못했다고 합니다. 확인 부탁드립니다.",
      files: [{ name: "스크린샷01.png", size: "1.2MB" }] },
    { role: "team", time: "04-28 17:24",
      body: "안녕하세요, 째피 고객지원팀입니다.\n불편을 드려 죄송합니다. 보내주신 트랜잭션을 확인한 결과 라이트닝 채널에서 일시적인 지연이 발생한 것으로 보입니다. 30분 이내 자동으로 정산되며, 정산 후에도 미수신 상태라면 다시 알려주세요." },
  ]);

  const send = () => {
    if (!draft.trim()) return;
    setThread([...thread, { role: "user", time: "방금", body: draft }]);
    setDraft("");
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <Header onBack={() => go("inquiry-list")}
        title="라이트닝 결제 오류 문의"
        subtitle="접수일 2026-04-28"
        meta={<>
          <StatusChip kind="answered" />
          <CategoryChip label="송수신 관련" />
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {thread.map((m, i) => <ThreadMessage key={i} {...m} />)}
        <div style={{
          textAlign: "center", fontSize: 11, color: csStyles.ink4,
          padding: "8px 0", letterSpacing: "-0.005em",
        }}>이어서 답변하면 같은 스레드에 기록돼요</div>
      </div>

      <div style={{
        padding: "10px 14px 22px",
        background: csStyles.surface,
        borderTop: `1px solid ${csStyles.hairline}`,
      }}>
        <div style={{
          display: "flex", alignItems: "flex-end", gap: 8,
          background: csStyles.bg,
          border: `1px solid ${csStyles.hairline}`,
          borderRadius: 22, padding: "6px 6px 6px 14px",
        }}>
          <button style={{
            width: 32, height: 32, border: "none", background: "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}><CSIcon.paperclip /></button>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="추가 문의 내용을 적어주세요"
            rows={1}
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontFamily: "var(--zt-font-ui)", fontSize: 13.5, color: csStyles.ink1,
              letterSpacing: "-0.005em", lineHeight: 1.5, padding: "8px 0",
              resize: "none", maxHeight: 80,
            }} />
          <button onClick={send} disabled={!draft.trim()} style={{
            width: 36, height: 36, borderRadius: 999, border: "none",
            background: draft.trim() ? csStyles.accent : "#D7D9E5",
            color: "#fff", cursor: draft.trim() ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            transition: "background 140ms",
          }}><CSIcon.send size={14} /></button>
        </div>
      </div>
    </div>
  );
}

// ── IdeaDetailScreen (chat, no status) ───────────────────────────────────────
function IdeaDetailScreen({ go }) {
  const [draft, setDraft] = React.useState("");
  const [thread, setThread] = React.useState([
    { role: "user", time: "04-28 16:40",
      body: "QR 스캔으로 결제 후, 상점 카테고리(카페·식사 등)가 자동으로 분류되면 가계부 정리가 훨씬 편할 것 같아요." },
    { role: "team", time: "04-29 10:12",
      body: "안녕하세요, 좋은 의견 감사합니다 :)\n자동 카테고리 분류는 저희도 내부적으로 검토하고 있는 주제예요. 어떤 분류 기준이 가장 유용할지 추가로 의견 들려주실 수 있을까요?" },
  ]);

  const send = () => {
    if (!draft.trim()) return;
    setThread([...thread, { role: "user", time: "방금", body: draft }]);
    setDraft("");
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <Header onBack={() => go("idea-list")}
        title="QR 스캔 후 자동 카테고리 분류"
        subtitle="보낸 일시 2026-04-28"
        meta={<>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: csStyles.accentSoft, color: csStyles.accent,
            fontSize: 11, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1,
          }}>
            <CSIcon.spark size={12} color={csStyles.accent} />아이디어
          </span>
          <CategoryChip label="UI / UX 개선" />
        </>} />

      <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {thread.map((m, i) => <ThreadMessage key={i} {...m} />)}
        <div style={{
          textAlign: "center", fontSize: 11, color: csStyles.ink4,
          padding: "8px 0", letterSpacing: "-0.005em",
        }}>제안에 대해 자유롭게 이야기를 이어갈 수 있어요</div>
      </div>

      <div style={{
        padding: "10px 14px 22px",
        background: csStyles.surface,
        borderTop: `1px solid ${csStyles.hairline}`,
      }}>
        <div style={{
          display: "flex", alignItems: "flex-end", gap: 8,
          background: csStyles.bg,
          border: `1px solid ${csStyles.hairline}`,
          borderRadius: 22, padding: "6px 6px 6px 14px",
        }}>
          <button style={{
            width: 32, height: 32, border: "none", background: "transparent",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}><CSIcon.paperclip /></button>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="이어서 의견을 들려주세요"
            rows={1}
            style={{
              flex: 1, border: "none", background: "transparent", outline: "none",
              fontFamily: "var(--zt-font-ui)", fontSize: 13.5, color: csStyles.ink1,
              letterSpacing: "-0.005em", lineHeight: 1.5, padding: "8px 0",
              resize: "none", maxHeight: 80,
            }} />
          <button onClick={send} disabled={!draft.trim()} style={{
            width: 36, height: 36, borderRadius: 999, border: "none",
            background: draft.trim() ? csStyles.accent : "#D7D9E5",
            color: "#fff", cursor: draft.trim() ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}><CSIcon.send size={14} /></button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { InquiryDetailScreen, IdeaDetailScreen });
