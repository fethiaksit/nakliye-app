# Corporate Approval and Wallet Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require admin approval for corporate accounts and expose wallet features only to approved corporate customers.

**Architecture:** Reuse existing account/company and wallet ledger models, adding approval metadata and enforcing it in backend handlers/services. Extend existing admin and corporate screens without changing unrelated flows.

**Tech Stack:** Go HTTP API, Redis store, React/TypeScript admin panel, React Native customer app.

**Spec:** User-provided Corporate Approval + Corporate Wallet requirements.

## Global Constraints

- Do not add dependencies.
- Do not alter Android Maps, messaging, driver, or unrelated customer flows.
- Do not use float for money.
- Reuse existing wallet admin routes and audit log.

### Task 1: Corporate approval state and admin actions

**Files:** existing corporate model/store/register/admin handlers and targeted tests.

- [ ] Add pending default and persisted approved/rejected metadata.
- [ ] Add admin listing/detail and approve/reject action using existing admin auth.
- [ ] Add failing backend tests, verify failure, implement, then rerun targeted tests.

### Task 2: Enforce approval in wallet backend

**Files:** existing corporate wallet handlers/store/delivery handlers and targeted tests.

- [ ] Add failing tests for pending/rejected/individual access and approved access.
- [ ] Enforce account type plus approved status at every wallet read, earn, and spend boundary.
- [ ] Preserve ledger idempotency, integer money, and usage cap behavior.

### Task 3: Admin and corporate customer UI

**Files:** existing AdminPanel/CorporateWalletAdmin and corporate customer screens.

- [ ] Add approval display/actions and approved-only wallet visibility.
- [ ] Show pending guidance and retain existing wallet settings/ledger UI.
- [ ] Add/extend focused render checks and TypeScript validation.

### Task 4: Verification and scoped commit

- [ ] Run only relevant Go, admin, and customer tests/builds.
- [ ] Inspect diff for unrelated files.
- [ ] Commit scoped changes as `feat: complete corporate approval and wallet flow` if clean.
