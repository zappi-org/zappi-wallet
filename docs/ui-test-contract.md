# UI 테스트 계약 (agent-drivable UI)

에이전트(또는 e2e 러너)가 **텍스트/i18n에 의존하지 않고** 앱을 조작·검증할 수 있게 하는 DOM 규약.
소스 오브 트루스는 `src/ui/lib/test-ids.ts` 이고, 이 문서는 왜 그렇게 하는지와 새 화면 추가 시
무엇을 해야 하는지만 다룬다.

전체 목록 출력:

```bash
bun scripts/list-test-ids.mjs
```

## 1. 우선순위 — aria-name 먼저, id는 그 다음

| 순위 | 수단 | 언제 |
|---|---|---|
| 1 | `aria-label` / 텍스트 / `role` | 모든 인터랙티브 요소. Orca `find --locator role\|label\|text`가 이걸 읽는다 |
| 2 | `data-testid` | a11y 이름으로 안정적 핸들을 못 주는 것: 아이콘 전용 컨트롤, 상태를 단언해야 하는 컨테이너, 리스트 행 |

id는 한국어 라벨을 영문으로 바꾼 것이 아니다. **라벨이 바뀌어도 id는 그대로여야 한다.**

## 2. id 형식

```
<screen>-<element>            signer-paste, my-address-copy
<screen>-<element>-row        signer-activity-row   (행 하나하나가 같은 id)
```

- 화면 접두사가 앱 전체 유일성을 만든다(기존 코드의 `camera-icon` 4중복 같은 사고 방지).
- 값은 `TEST_IDS` 상수에서만 온다. JSX에 문자열 하드코딩 금지.

## 3. 리스트 행 — 위치가 아니라 신원으로

```tsx
<div {...rowAttrs(TEST_IDS.signer.activityRow, item.id, index)} />
// data-testid="signer-activity-row" data-item-id="<event id>" data-index="0"
```

- `data-testid`는 **고정**, 변하는 부분은 `data-item-id`(엔티티 키)와 `data-index`(순서).
- 행이 추가/정렬되어도 기존 단언이 깨지지 않는다. 위치로 찾아야 할 때만 `data-index`.

## 4. 상태 영역 — 텍스트 파싱 금지

```tsx
<div {...stateAttrs(TEST_IDS.signer.activityList, state, items.length)} />
// data-state="empty|loading|ready|error" data-count="5"
```

- `data-state` 값 집합은 닫혀 있다(`stateAttrs` 타입으로 강제). 새 상태를 추가하려면
  헬퍼 타입을 고치고 이 문서를 갱신한다 — 즉 리뷰에 걸린다.
- "비어 있음"을 `textContent.includes('없습니다')`로 판정하지 않는다. 그건 i18n과 결합된다.

## 5. 절대 금지

- **민감정보**: PIN, 니모닉, 서명 원문, 토큰을 `data-testid`/`data-*`/`aria-label`에 넣지 않는다.
  e2e 로그·스크린샷·DOM 덤프로 새기 때문. (`signer-activity-*`는 `data-item-id`=이벤트 id만.)
- **라벨 파생 id**: `settings-row-${t('...')}` 같은 자동 생성.
- **인덱스 기반 정적 id**: `-0`, `-1`을 id에 박는 것 → `data-item-id`로 대체.
- **테스트 전용 DOM**: 보이지 않는 히든 버튼/셀렉터를 심는 것. 조작 경로는 사용자가 쓰는
  경로와 같아야 테스트가 의미를 가진다.

## 6. 새 화면 추가 체크리스트

1. `TEST_IDS`에 화면 키 추가 (`screen` + 상호작용 요소들).
2. 모든 인터랙티브 요소에 `aria-label` 또는 가시 텍스트 확보.
3. 리스트는 `rowAttrs`, 상태 컨테이너는 `stateAttrs`.
4. `bun scripts/list-test-ids.mjs`로 목록 확인.
5. 스크린샷 1장 + `data-state` 확인으로 실제 브라우저에서 검증.
