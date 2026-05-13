---
"zappi-wallet": patch
---

refactor: token reclaim flow with Result<BaseError> pattern and improved UX
- Migrate reclaim flow to Result<T, E> pattern with BaseError types
- Add ReclaimService for dedicated reclaim business logic
- Add TokenSpentError for already-claimed tokens, UnknownError for failures
- Improve error handling with i18n toast messages (KO/EN/ES/JA/ID)
- Fix TokenDetailScreen to work within ServiceProvider scope
- Fix pending-items query to use Repository API with outcome filter
- Add auto-detection when recipient claims before sender reclaims
- Close reclaim sheet after confirm regardless of result
- Add 18 unit tests for ReclaimService
