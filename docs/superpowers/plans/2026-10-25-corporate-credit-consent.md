# Corporate credit consent implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** Explicit driver consent and atomic credit compensation using existing wallets.
**Architecture:** Pending payment status and immutable consent snapshot on Load; reuse corporate allocation and existing completion WATCH/MULTI.
**Tech Stack:** Go, Redis, React Native, React admin.
**Spec:** docs/superpowers/specs/2026-10-25-corporate-credit-driver-consent-design.md (approved with user constraints).

## Constraints
Minimum changes; preserve existing user edits; no production deployment; no second wallet; integer kuruş; no historical compensation.

## Review focus
Stale decisions after reselection; concurrent completion/cancellation; direct status bypass; post-acceptance wallet mutation; commission and compensation writing the same wallet.

## Task 1: Backend consent and settlement
- [x] Add API test for 410000/6000/404000/41000/40400 amounts and run to observe failure.
- [x] Add paymentApproval snapshot and payment_approval_pending status; select credit with atomic corporate debit and pending state.
- [x] Confirm through existing AcceptOffer transaction; reject/refund atomically and retain audit. Guard direct status/credit bypass.
- [x] Extend CompleteDeliveryWithReward to add CORPORATE_CREDIT_COMPENSATION after commission on the same wallet and transaction.
- [x] Test reject/reselect, cancellation, concurrent decisions/completion, unauthorized actors, retry, legacy behavior; run Go suite and race checks.

## Task 2: Mobile/admin display
- [x] Add shared payment presentation helper tests; run failing tests.
- [x] Customer chooses credit on offer acceptance. Driver sees breakdown and explicit accept/reject; customer sees approval status. Admin sees consent and settled compensation separately.
- [x] Run mobile tests, JSX checks and admin checks.

## Task 3: Verification and beta handoff
- [x] Review diff and rerun affected checks after fixes.
- [x] Write beta verification checklist and actual test results; leave changes local without deployment.

## Execution ledger
Ruling: Work in current checkout, preserve existing edits, no extra confirmation per user instruction. No automatic commits of mixed user changes.

Task 1 verification: end-to-end 4100/60 scenario, authorization, reject/reselect, cash reselection (same/different driver), cancellation, concurrent decisions, concurrent completion, completion versus cancellation, corrupted-index rollback prevention, separate real Redis test implemented. Existing wallet tests migrated to select credit before driver consent. State markers from a concurrent winner now return a conflict rather than an incorrect balance error.
Task 2 verification: customer 55 tests, driver 4 rendered-behavior tests, admin 7 build/render tests and TypeScript check; six mobile JSX files parsed. No new dependencies.
Review: independent review found stale rejected terms on cash acceptance; fixed with regression coverage. Work remains local for beta device testing; no commit, merge, push or deployment performed.

Final verification: full Go suite 181 pass / 1 opt-in skip, latest full Go race check passed (httpapi 92.150s), repeated race scenarios 20 times passed, disposable real Redis passed and stopped. Customer 55 / driver 4 / admin 7 tests passed; TypeScript and changed JSX parse checks passed. Beta report: docs/testing/2026-10-25-corporate-credit-beta.md.
