# QA Checklist Format

Write to `.pipeline/qa-checklist.md`.

```markdown
---
date: YYYY-MM-DD
branch: <current branch>
affected_flow: <from plan.md>
---

# QA Checklist

## Critical

- [ ] <specific steps to verify the fix/feature works>
- [ ] <specific steps to verify>

## Regression

- [ ] <check surrounding features still work>
- [ ] <check>

## Edge Cases

- [ ] <edge case scenario with steps>

## Platform

- [ ] iOS Safari: <what to check>
- [ ] Android Chrome: <what to check>
- [ ] PWA standalone: <what to check if relevant>
```

## Notes

- Each item: specific user action + expected result
- Bad: "검색이 작동하는지 확인"
- Good: "거래내역 화면 진입 → 키보드 올라오지 않음 → 검색 아이콘 탭 → 검색바 열림 → 검색 input 탭 → 키보드 올라옴"
