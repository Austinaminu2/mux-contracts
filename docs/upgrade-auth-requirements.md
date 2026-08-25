# Upgrade Auth Requirements

**Version:** 0.1.0  
**Date:** 2026-07-25  
**Status:** Draft  
**Related:** [Contract Upgrade Pattern](contract-upgrade-pattern.md), [Access Control Checklist](access-control-checklist.md)

---

## Purpose

This document defines the authentication requirements for upgrading Mux Protocol Soroban contracts on mainnet. Every upgrade must satisfy all requirements below before execution.

---

## Upgrade authority model

| Layer | Requirement | Rationale |
|-------|-------------|-----------|
| **Admin key** | Stored during `initialize()`, read by `require_admin()` before every `upgrade()` call | Prevents unauthorised WASM replacement |
| **Auth enforcement** | `admin.require_auth()` is called **before** `env.deployer().update_current_contract_wasm()` | Soroban charges auth — the transaction fails if the admin did not sign |
| **Multisig / governance** | Mainnet admin MUST be a multisig or governance contract, never a single EOA | Limits single-key compromise blast radius |
| **Key rotation** | Admin transfer documented in deploy checklist; old key drained after transfer | Reduces长期 exposure |

---

## Per-contract upgrade status

| Contract | Has `upgrade()` | Auth pattern | Notes |
|----------|----------------|--------------|-------|
| `mux-account` | Not yet | N/A (immutable) | Deployment is currently immutable; upgrade path documented but entry point not exposed |
| `mux-account-factory` | Not yet | N/A (immutable) | No on-chain upgrade entry point |
| `mux-batcher` | **Yes** | `require_admin()` → `require_auth()` | Admin is optional — set via `initialize(admin)`; a batcher never initialized has no `upgrade()` path (`NotInitialized`). Batching itself never required an admin. See [batcher-upgrade.md](batcher-upgrade.md) |
| `mux-delegation` | **Yes** | `require_admin()` → `require_auth()` | Admin is optional — set via `initialize(admin)`; independent of the caller-supplied `admin` param on `link_contract_id`. See [delegation-upgrade.md](delegation-upgrade.md) |
| `mux-permissions` | **Yes** | `require_admin()` → `require_auth()` | Reuses the same `DataKey::Admin` / `require_admin()` used by role and multisig-rotation entrypoints. See [permissions-upgrade-migration.md](permissions-upgrade-migration.md) |
| `mux-policy` | **Yes** | `require_admin()` → `require_auth()` | Admin is set at `initialize()` time (mandatory) |
| `mux-recovery` | Not yet | N/A (immutable) | Recovery timelock is time-critical; upgrade path requires careful design |
| `mux-registry` | Not yet | N/A (immutable) | See [contract-upgrade-pattern.md](contract-upgrade-pattern.md) |
| `mux-spending-policy` | Not yet | N/A (immutable) | No on-chain upgrade entry point |
| `mux-wallet-registry` | Not yet | N/A (immutable) | See [contract-upgrade-pattern.md](contract-upgrade-pattern.md) |

---

## Auth flow for `upgrade()`

```
Caller (multisig / governance)
  │
  ├─ Sign transaction with admin key(s)
  │
  ▼
contract.upgrade(new_wasm_hash)
  │
  ├─ 1. Read stored admin from DataKey::Admin
  ├─ 2. admin.require_auth()  ← Soroban charges the auth
  ├─ 3. env.deployer().update_current_contract_wasm(new_wasm_hash)
  │
  ▼
Contract now runs new WASM at same address
```

### Required code pattern

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), ContractError> {
    Self::require_admin(&env)?;
    env.deployer().update_current_contract_wasm(new_wasm_hash);
    Ok(())
}

fn require_admin(env: &Env) -> Result<(), ContractError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(ContractError::NotInitialized)?;
    admin.require_auth();
    Ok(())
}
```

---

## Pre-upgrade checklist

Before every production upgrade:

- [ ] New WASM hash verified against source commit (run `scripts/verify-wasm-hash.sh`)
- [ ] All existing tests pass against the new WASM
- [ ] Storage layout changes are backward-compatible or a `migrate()` function is ready
- [ ] Testnet upgrade completed and smoke-tested
- [ ] Admin key (multisig threshold) is available and hardware-secured
- [ ] Upgrade transaction simulated with `--fee-bump` if needed
- [ ] Rollback plan documented — prior WASM hash retained
- [ ] At least two engineers online during the upgrade window
- [ ] Team notified of upgrade window (minimum 24 h notice for mainnet)

---

## Post-upgrade verification

- [ ] Contract responds to a read call (e.g., `get_version()` or `account_count()`)
- [ ] Contract WASM hash matches the uploaded hash
- [ ] Pre-upgrade state is readable and correct
- [ ] New behaviour (if any) works as expected
- [ ] Events emitted during upgrade are indexed correctly

---

## Rollback procedure

Soroban does not natively support rollback. Mitigation:

1. **Retain prior WASM hash** — content-addressed, always available on-ledger
2. **Call `upgrade()` again** with the prior hash to revert code
3. **If storage was migrated** — run a prepared reverse `migrate()` before reverting WASM

---

## Emergency upgrade protocol

For critical security fixes requiring immediate upgrade:

1. Contact all admin multisig signers
2. Simulate the upgrade transaction on testnet first (if time permits)
3. Execute with `--fee-bump` to protect against ledger close during signing
4. Monitor contract state for 1 hour post-upgrade
5. File incident report within 24 hours

---

## References

- [Contract Upgrade Pattern](contract-upgrade-pattern.md)
- [Access Control Checklist](access-control-checklist.md)
- [Soroban Upgradeable Contract Docs](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/upgradeable-contract)
