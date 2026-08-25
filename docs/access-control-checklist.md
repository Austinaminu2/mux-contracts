# Mux Protocol — Access Control Review Checklist

**Version:** 0.1.0  
**Date:** 2026-05-30  
**Purpose:** Use this checklist before every contract release, audit engagement, or major feature PR to verify that access control is correctly enforced across all Mux Protocol contracts.

---

## How to Use

Work through each section.  Mark every item **Pass**, **Fail**, or **N/A** with a brief note.  All items must be **Pass** or **N/A** before a contract deployment is approved.

```
Legend:
  [x] Pass
  [ ] Fail — add remediation note
  [-] N/A  — explain why
```

---

## 1. Authentication (`require_auth`)

### 1.1 `mux-account`

- [ ] `initialize` — `owner.require_auth()` called before any storage write.
- [ ] `set_delegate` — `require_owner` helper called; verifies `owner.require_auth()`.
- [ ] `remove_delegate` — `require_owner` helper called.
- [ ] `set_spend_limit` — `require_owner` helper called.
- [ ] `debit_spend` — `current_contract_address().require_auth()` called (contract-internal only).
- [ ] No public function mutates storage without an auth check.

### 1.2 `mux-batcher`

- [ ] `execute_batch` — `caller.require_auth()` called before any operations are dispatched.
- [ ] `simulate_batch` — `caller.require_auth()` called (preflight is also auth-gated).
- [ ] Batch operations are dispatched under the **caller's** auth context, not the batcher contract's.
- [ ] `initialize` — `admin.require_auth()` called before storage write; optional (batching works without it).
- [ ] `upgrade` — `require_admin` helper called; `NotInitialized` (fail-closed) if `initialize` was never called; no silent skip of the auth check.

### 1.3 `mux-permissions`

- [ ] `initialize` — `admin.require_auth()` called before storage write.
- [ ] `create_role` — `require_admin` helper called.
- [ ] `grant_role` — `require_admin` helper called.
- [ ] `revoke_role` — `require_admin` helper called.
- [ ] `has_permission`, `get_roles`, `get_role_members` — read-only; no auth required (acceptable).
- [ ] No role mutation is possible without admin signature.
- [ ] `upgrade` — `require_admin` helper called; WASM upgrade is admin-gated (same helper used by role and multisig-rotation entrypoints).
- [ ] `propose_admin` / `approve_admin` — both fail-closed with no admin auth mocked at all (unit test: `test_admin_rotation_calls_require_admin_auth`); approvals below the configured threshold do not change the stored admin (unit test: `test_multisig_admin_promotion_transfers_control`).

### 1.4 `mux-policy`

- [ ] `initialize` — `admin.require_auth()` called before storage write.
- [ ] `set_daily_limit` — `require_admin` helper called; only admin can configure limits.
- [ ] `record_spend` — `wallet.require_auth()` called before any storage write; third parties cannot debit a wallet's allowance.
- [ ] `reset_daily_counter` — `require_admin` helper called; only admin can perform emergency resets.
- [ ] `upgrade` — `require_admin` helper called; WASM upgrade is admin-gated.
- [ ] No policy mutation is possible without the correct authorization.

### 1.5 `mux-registry`

- [ ] `initialize` — `admin.require_auth()` called before storage write.
- [ ] `register` — `require_admin` helper called.
- [ ] `register_with_metadata` — `require_admin` helper called.
- [ ] `get_version`, `get_metadata`, `list_contracts`, `check_version` — read-only; no auth required (acceptable).
- [ ] No registry mutation is possible without admin signature.

### 1.6 `mux-recovery`

- [ ] `initialize` — `owner.require_auth()` called before storage write.
- [ ] `initiate_recovery` — `guardian.require_auth()` + `require_guardian` helper called.
- [ ] `cancel_recovery` — `require_owner` helper called; only current owner can cancel.
- [ ] `execute_recovery` — `guardian.require_auth()` + `require_guardian` helper called.
- [ ] No recovery mutation is possible without guardian or owner authorization.

### 1.7 `mux-delegation`

- [ ] `grant_delegate` — `owner.require_auth()` called before any storage write.
- [ ] `revoke_delegate` — `owner.require_auth()` called before any storage write.
- [ ] `link_contract_id` — the caller-supplied `admin` parameter authorizes **itself**; this is **not** checked against any stored admin identity, so it is not a privileged gate against other callers — see `docs/delegation-upgrade.md`.
- [ ] `initialize` — `admin.require_auth()` called before storage write; optional (delegation grants work without it) and establishes a **separate** stored admin used only by `upgrade`.
- [ ] `upgrade` — `require_admin` helper called; `NotInitialized` (fail-closed) if `initialize` was never called.
- [ ] `get_delegate_permissions`, `is_delegate`, `get_delegates`, `check_delegate`, `get_contract_id` — read-only; no auth required (acceptable).

---

## 2. Initialization Guards

- [ ] `mux-account`: Second call to `initialize` returns `AlreadyInitialized` error; verified by unit test `test_double_initialize_fails`.
- [ ] `mux-permissions`: Second call to `initialize` returns `AlreadyInitialized` error; verified by unit test `test_double_initialize_fails`.
- [ ] No contract function silently overwrites initialized state on re-call.
- [ ] All contracts check `env.storage().instance().has(&DataKey::Owner/Admin)` before setting it.

---

## 3. Role and Delegate Validation

- [ ] `grant_role` rejects unknown role names (`RoleNotFound` error).
- [ ] `revoke_role` rejects accounts not in the role (`AccountNotInRole` error).
- [ ] `set_delegate` stores a well-typed `DelegateInfo` struct; no raw address coercion.
- [ ] `remove_delegate` returns `DelegateNotFound` rather than silently succeeding.
- [ ] Delegate `expires_at` timestamp is enforced at call time, not just at creation time.
- [ ] `can_spend` flag is correctly propagated to spend-limit checks.

---

## 4. Spend Limit Controls

- [ ] Spend limit amount must be > 0; `InvalidAmount` returned otherwise (unit test: `test_spend_limit_invalid_amount`).
- [ ] Period ledgers must be > 0; `InvalidPeriod` returned otherwise.
- [ ] `debit_spend` rolls over the period counter using `env.ledger().sequence()` — no off-chain clock dependency.
- [ ] Accumulated `spent` is reset to 0 at period boundary, not merely decremented.
- [ ] `spent + spend > amount` check uses Rust checked arithmetic (overflow-checks = true in profile).
- [ ] Spend limit is per-asset; different assets cannot cross-cover each other.

---

## 5. Batch Execution Safety

- [ ] Empty batch (`ops.is_empty()`) returns `EmptyBatch`; transaction reverts.
- [ ] Batch size > `MAX_BATCH_SIZE` (50) returns `BatchTooLarge`; transaction reverts.
- [ ] `require_success = true` operations abort the entire batch on failure (not just skip).
- [ ] `require_success = false` operations record failure count without aborting.
- [ ] Cross-contract invocations inside the batch cannot re-enter `mux-batcher` itself.
- [ ] The caller of `execute_batch` is documented to be responsible for vetting target contracts.

---

## 6. Storage Isolation

- [ ] Each contract uses its own `DataKey` enum with no overlapping key names across contracts.
- [ ] All storage reads use `ok_or(SomeError::NotInitialized)` — no silent `unwrap` that could panic post-deployment.
- [ ] Persistent storage keys are namespaced by type (e.g., `SpendLimit(Address)` vs `Delegates`).
- [ ] No contract reads or writes to another contract's storage directly.

---

## 6a. Storage Griefing Caps

See [docs/storage-griefing.md](storage-griefing.md) for full details.

- [ ] `mux-account`: `set_delegate` enforces `MAX_DELEGATES = 64`; new entries beyond cap return `TooManyDelegates` (unit test: `test_delegate_cap_enforced`).
- [ ] `mux-account`: updating an existing delegate at cap succeeds (unit test: `test_delegate_cap_allows_update`).
- [ ] `mux-account-factory`: `deploy_account` and `deploy_account_with_metadata` enforce `MAX_ACCOUNTS_PER_OWNER = 64` per owner; new deploys beyond cap return `TooManyAccounts` (unit tests: `test_accounts_cap_enforced`, `test_deploy_account_with_metadata_enforces_cap`).
- [ ] `mux-account-factory`: `simulate_deploy` and `simulate_deploy_with_metadata` enforce the same 64-account cap without writing state (unit tests: `test_simulate_deploy_enforces_cap`, `test_simulate_deploy_with_metadata_enforces_cap`).
- [ ] `mux-account-factory`: per-owner cap is independent — one owner filling their cap does not block other owners (unit test: `test_cap_is_per_owner_not_global`).
- [ ] `mux-account-factory`: metadata string sizes are bounded (`MAX_VERSION_LENGTH = 32`, `MAX_DESCRIPTION_LENGTH = 256`, `MAX_AUTHOR_LENGTH = 64`); oversized strings return `MetadataTooLarge` (unit tests: `test_metadata_version_too_long`, `test_metadata_description_too_long`, `test_metadata_author_too_long`).
- [ ] `mux-account-factory`: `max_accounts_per_owner()` public entrypoint returns 64; TypeScript clients must query this before deploy to avoid `TooManyAccounts` (unit test: `test_max_accounts_per_owner_returns_64`).
- [ ] `mux-permissions`: `grant_role` enforces `MAX_ROLE_MEMBERS = 256` per role; returns `TooManyMembers` (unit test: `test_role_member_cap_enforced`).
- [ ] `mux-permissions`: `grant_role` enforces `MAX_ROLES_PER_ACCOUNT = 32` per account; returns `TooManyRoles` (unit test: `test_roles_per_account_cap_enforced`).
- [ ] All three contracts call `env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO)` on every write (T-21 mitigation).
- [ ] TTL constants: `TTL_THRESHOLD = 17_280` (~1 day), `TTL_EXTEND_TO = 518_400` (~30 days).
- [ ] Deployment runbook includes a keeper job that extends TTL at least every 25 days (see [docs/storage-griefing.md](storage-griefing.md#deployment-runbook--ttl-keeper)).

---

## 7. Error Handling

- [ ] All error types are `#[contracttype]` decorated enums with explicit `#[repr(u32)]` discriminants.
- [ ] No error arm uses discriminant 0 (reserved for success in some SDKs).
- [ ] Errors are propagated via `Result<_, Error>` — no `panic!` except in `require_success` abort path.
- [ ] Error codes are stable across contract versions (no re-numbering without a major version bump).

---

## 7a. Panic-Free Error Paths

- [ ] **No bare `.unwrap()` on storage reads.** Every `env.storage().*().get(...)` uses `.ok_or(Error::Variant)` or `.unwrap_or(default)`. Bare `.unwrap()` on a missing key would panic post-deployment.
- [ ] **No bare `.expect(...)` on fallible operations.** Replace with `.ok_or(Error)` or pattern matching.
- [ ] **Checked arithmetic on all user-controlled values.** `spent + amount` uses `checked_add().ok_or(Error)?`. Subtraction uses `checked_sub()` or `saturating_sub()`. The workspace `Cargo.toml` sets `overflow-checks = true` but contracts should not rely on this as a substitute for explicit checks.
- [ ] **No `panic!`, `unreachable!`, or `unimplemented!` in production paths.** These macros are acceptable in `#[cfg(test)]` code only.
- [ ] **`Vec::get(idx)` is bounds-checked.** Soroban SDK `Vec::get` panics on out-of-bounds access; always verify `idx < vec.len()` first or use `.try_get()`.
- [ ] **`require_auth()` failures propagate as host errors**, not contract panics. This is safe because the SDK handles auth failures internally.
- [ ] **No implicit integer truncation.** `u32` / `i128` conversions use `.try_into()` or explicit casts with overflow guards.
- [ ] **All error paths are tested.** Every `Err(...)` variant returned by a public function has at least one `try_*` test that asserts the error variant.

### Quick audit commands

```bash
# Find bare .unwrap() in contract source (exclude tests)
rg '\.unwrap\(\)' contracts/*/src/lib.rs | grep -v '#\[cfg(test)\]' | grep -v '// '

# Find panic!/unreachable!/unimplemented! in non-test code
rg 'panic!|unreachable!|unimplemented!' contracts/*/src/lib.rs | grep -v '#\[cfg(test)\]'
```

---

## 8. Unit Test Coverage

- [ ] `mux-account`: `initialize`, double-initialize, delegate CRUD, spend limit enforcement, invalid amount/period.
- [ ] `mux-batcher`: empty batch, oversized batch, `initialize`/double-initialize/`upgrade` before `initialize`, `upgrade` auth rejection.
- [ ] `mux-delegation`: grant/revoke CRUD, `initialize`/double-initialize/`upgrade` before `initialize`, `upgrade` auth rejection.
- [ ] `mux-permissions`: initialize, double-initialize, role create/grant/revoke, permission check, nonexistent role grant, admin-threshold promotion (below-threshold no-op, at-threshold transfer), admin-rotation auth rejection, `upgrade` before `initialize`, `upgrade` auth rejection.
- [ ] All `require_owner` / `require_admin` paths have a negative test (unauthorized caller).
- [ ] All `AlreadyInitialized` paths have a test.
- [ ] CI runs `cargo test --workspace --all-features` on every PR (see `.github/workflows/ci.yml`).

---

## 9. CI / CD Verification

- [ ] `cargo clippy --workspace --all-features -- -D warnings` passes with no warnings.
- [ ] `cargo fmt --check` passes.
- [ ] Bindings drift check (`check-binding-drift` job) passes on PRs.
- [ ] Release builds use `[profile.release]` with `overflow-checks = true` and `panic = "abort"`.
- [ ] WASM artifacts are uploaded and SHA-256 is published in the release notes.

---

## 10. Deployment Checklist

- [ ] Admin / owner keypairs generated on HSM or hardware wallet — not software-only.
- [ ] Admin keypair for `mux-permissions` is a Stellar multisig account with threshold ≥ 2.
- [ ] Initial guardian set contains ≥ 3 geographically distributed addresses.
- [ ] Contract IDs recorded in `bindings/src/network.ts` for the correct network.
- [ ] `stellar contract invoke` smoke-test run against testnet deployment before mainnet.
- [ ] Upgrade authority (if any) is a timelocked multisig — documented and reviewed.
- [ ] No `#[cfg(test)]` code or `testutils` feature enabled in the release WASM (run `make check-no-testutils` / see [no-testutils-wasm.md](no-testutils-wasm.md)).

---

## 11. Authorization Flow Examples

### Owner → Delegate → Spend (mux-account)

```
1. Owner calls initialize(owner, guardians)
   └─ owner.require_auth() ✓
   └─ Storage: Owner, Delegates={}, GuardianSet, Nonce=0

2. Owner calls set_delegate(delegate, expiry, can_spend=true)
   └─ require_owner() → owner.require_auth() ✓
   └─ Storage: Delegates[delegate] = DelegateInfo{expiry, can_spend}

3. Delegate calls debit_spend(asset, amount)
   └─ current_contract_address().require_auth() (contract-internal only)
   └─ Checks: not paused, not re-entered, limit not exceeded
   └─ Storage: SpendLimit(asset).spent += amount
```

### Policy Record Spend (mux-policy)

```
1. Admin calls set_daily_limit(wallet, limit, day_ledgers)
   └─ require_admin() → admin.require_auth() ✓
   └─ Storage: WalletLimit(wallet) = DailyLimit{limit, spent=0, ...}

2. Wallet calls record_spend(wallet, amount)
   └─ wallet.require_auth() ✓  ← only the wallet itself can debit
   └─ Checks: limit exists, amount > 0, spent + amount <= limit
   └─ Storage: WalletLimit(wallet).spent += amount
   └─ Third-party call fails: wallet A cannot record_spend for wallet B
```

### Registry Registration (mux-registry)

```
1. Admin calls register(name, version)
   └─ require_admin() → admin.require_auth() ✓
   └─ Checks: Names.len < 128 (TooManyContracts if exceeded)
   └─ Storage: Names.push(name), Version(name) = version

2. Anyone calls get_version(name) — read-only, no auth needed
```

### Recovery Timelock (mux-recovery)

```
1. Guardian calls initiate_recovery(guardian, new_owner)
   └─ guardian.require_auth() ✓ + require_guardian() ✓
   └─ Storage: Recovery = RecoveryRequest{Pending, executable_at}

2. Owner calls cancel_recovery()  [within timelock window]
   └─ require_owner() → owner.require_auth() ✓
   └─ Storage: Recovery.status = Cancelled

3. Guardian calls execute_recovery(guardian)  [after timelock]
   └─ guardian.require_auth() ✓ + require_guardian() ✓
   └─ Checks: status == Pending, current_ledger >= executable_at
   └─ Storage: Owner = new_owner
```

---

## 12. Sign-off

| Reviewer | Role | Date | Result |
|---|---|---|---|
| | Contract author | | |
| | Security reviewer | | |
| | Protocol lead | | |

**All items must be marked Pass or N/A, and the table above signed, before deploying to mainnet.**
