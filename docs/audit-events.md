# Mux Protocol — Audit Log Events

**Version:** 0.1.0  
**Status:** Living document — update whenever a new event is added or an existing one changes.

> **Conventions:** Topic layout, naming rules, and TypeScript filter notes are defined in
> [event-topic-conventions.md](event-topic-conventions.md). This file is the per-contract catalog.

---

## Overview

Every state-mutating operation in Mux contracts emits a Soroban event via `env.events().publish(topics, data)`.  
Events are indexed on-chain and can be streamed from any Soroban RPC node using the `getEvents` method.

### Topic structure

All events use a two-element topic vector:

```
topics[0]  contract_tag  Symbol  e.g. "mux_acct", "mux_perm", "mux_bat"
topics[1]  action        Symbol  e.g. "init", "dlg_set", "role_grt"
```

The `data` field carries action-specific payload encoded as a Soroban `Val`.

See [event-topic-conventions.md](event-topic-conventions.md) for naming rules, the full tag table, and RPC filter examples.

---

## mux-account events

Contract tag: `mux_acct`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `owner: Address` |
| `unpaused` | `unpause` succeeds | `()` |
| `dlg_set` | `set_delegate` succeeds | `(delegate: Address, expires_at: u64, can_spend: bool)` |
| `dlg_rm` | `remove_delegate` succeeds | `delegate: Address` |
| `lmt_set` | `set_spend_limit` succeeds | `(asset: Address, amount: i128, period_ledgers: u32)` |
| `debited` | `debit_spend` succeeds | `(asset: Address, spend: i128)` |
| `ses_exe` | `execute_with_session` succeeds | `SessionExecutedEvent { session_key: Address, payload_len: u32 }` |

---

## mux-account-factory events

Contract tag: `mux_fac`

| Action | Trigger | Data payload |
|---|---|---|
| `deployed` | `deploy_account` or `deploy_account_with_metadata` succeeds | `(owner: Address, account_address: Address)` |
| `meta_set` | `deploy_account_with_metadata` succeeds | `(owner: Address, account_address: Address, version: String)` |

Event ordering within a single `deploy_account_with_metadata` call:
1. `deployed` — always emitted first
2. `meta_set` — always emitted second, in the same transaction

**No-event paths** — the following entrypoints are read-only or validation-only
and **must never emit events**:

| Entrypoint | Reason |
|---|---|
| `get_accounts` | Pure read — no state mutation |
| `account_count` | Pure read — no state mutation |
| `get_account_metadata` | Pure read — no state mutation |
| `simulate_deploy` | Dry-run validation; no storage written |
| `simulate_deploy_with_metadata` | Dry-run validation; no storage written |
| `max_accounts_per_owner` | Returns a constant; no storage touched |

Auth failures (`owner.require_auth()` rejected) and all `Result::Err` return
paths (`InvalidAccount`, `TooManyAccounts`, `MetadataTooLarge`) also emit zero
events — the emit call is only reached after every validation step passes.

**TypeScript — filtering factory events:**

```ts
import {
  FACTORY_CONTRACT_TAG,
  FACTORY_EVENT_TOPICS,
  parseFactoryEvent,
  type FactoryEvent,
} from "@mux-protocol/contracts";

const rawEvents = await server.getEvents({
  startLedger,
  filters: [{
    type: "contract",
    contractIds: [FACTORY_CONTRACT_ID],
    topics: [[FACTORY_CONTRACT_TAG]],          // filter by contract tag only
  }],
});

const events: FactoryEvent[] = rawEvents.records
  .map(parseFactoryEvent)
  .filter((e): e is FactoryEvent => e !== null);

// Narrow to just deploys:
const deploys = events.filter(e => e.action === "deployed");
// Narrow to just metadata updates:
const metaUpdates = events.filter(e => e.action === "meta_set");
```

---

## mux-permissions events

Contract tag: `mux_perm`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `admin: Address` |
| `role_crt` | `create_role` succeeds | `role: Symbol` |
| `role_grt` | `grant_role` succeeds | `(account: Address, role: Symbol)` |
| `role_rev` | `revoke_role` succeeds | `(account: Address, role: Symbol)` |
| `adm_thr` | `set_admin_threshold` succeeds | `threshold: u32` |
| `adm_prp` | `propose_admin` adds a new candidate | `new_admin: Address` |
| `adm_apr` | `approve_admin` records an approval (threshold not yet reached) | `(approver: Address, new_admin: Address)` |
| `adm_prm` | `approve_admin` promotes a candidate (threshold reached) | `new_admin: Address` |

> `upgrade` emits no event — instance storage (including this event log's
> continuity) survives the WASM replace, so there is nothing new to log; the
> upload/invoke transaction itself is the audit record. Follows the same
> convention as `mux-policy`'s `upgrade`.

---

## mux-delegation events

Contract tag: `mux_dlg`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `admin: Address` |
| `dlg_grant` | `grant_delegate` succeeds | `(owner: Address, delegate: Address)` |
| `dlg_rev` | `revoke_delegate` succeeds | `(owner: Address, delegate: Address)` |
| `dlg_link` | `link_contract_id` succeeds | `(admin: Address, contract_id: Address)` |

Events are emitted only on success. Failed calls (auth failure, empty
permissions, cap exceeded) emit no events. `upgrade` emits no event — see
the note under mux-permissions above; the same convention applies here.

> **Note:** `initialize` is optional and only establishes the `upgrade()`
> admin — it is independent of the `admin` parameter accepted by
> `link_contract_id`, which authorises itself and is not checked against the
> stored admin. See [delegation-upgrade.md](delegation-upgrade.md).

> **Note:** The event data carries only `(owner, delegate)`. The full
> permission list granted/revoked is **not** included in the event — retrieve
> it via `get_delegate_permissions` if needed.

**TypeScript — subscribing and parsing delegation events:**

```ts
import {
  DELEGATION_CONTRACT_TAG,
  DELEGATION_GRANT_ACTION,
  DELEGATION_REVOKE_ACTION,
  parseDelegationEvent,
  type DelegationEvent,
} from "@mux-protocol/contracts";

const rawEvents = await server.getEvents({
  startLedger,
  filters: [{
    type: "contract",
    contractIds: [DELEGATION_CONTRACT_ID],
    topics: [[DELEGATION_CONTRACT_TAG]],   // all mux_dlg events
  }],
});

const events: DelegationEvent[] = rawEvents.records
  .map(parseDelegationEvent)
  .filter((e): e is DelegationEvent => e !== null);

// Narrow to grants only:
const grants = events.filter(e => e.action === DELEGATION_GRANT_ACTION);
// Narrow to revokes only:
const revokes = events.filter(e => e.action === DELEGATION_REVOKE_ACTION);
```

See [`docs/delegation-permission-model.md`](delegation-permission-model.md)
for the full permission model and security notes.

---

## mux-batcher events

Contract tag: `mux_bat`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `admin: Address` |
| `bat_start` | `execute_batch` starts, after size checks pass | `(caller: Address, op_count: u32)` |
| `executed` | `execute_batch` completes (success or partial failure) | `(caller: Address, success_count: u32, failure_count: u32)` |
| `bat_ok` | `execute_batch` completes with zero failures | `(caller: Address, success_count: u32)` |
| `bat_abort` | `execute_batch` aborts on a required-operation failure | `caller: Address` |
| `sim_done` | `simulate_batch` completes | `(caller: Address, success_count: u32)` |

> `simulate_batch` writes no state but does emit `sim_done` for off-chain
> observability. `upgrade` emits no event — see the note under
> mux-permissions above; the same convention applies here. `initialize` is
> optional and only establishes the `upgrade()` admin — batching itself
> never required one.

---

## mux-spending-policy events

Contract tag: `mux_spend`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `admin: Address` |
| `lmt_set` | `set_policy` succeeds | `(account: Address, asset: Address, limit: i128)` |
| `chk_ok` | `check_spend` succeeds (within limit) | `(account: Address, asset: Address, amount: i128)` |
| `chk_ex` | `check_spend` fails (exceeds limit or policy not found) | `(account: Address, asset: Address, amount: i128, limit_or_reason: i128 | Symbol)` |

> `get_policy` is read-only and emits no events.

---

## mux-wallet-registry events

Contract tag: `mux_wreg`

| Action | Trigger | Data payload |
|---|---|---|
| `init` | `initialize` succeeds | `owner: Address` |
| `wlt_reg` | `register_wallet` succeeds (new entry or overwrite) | `(name: Symbol, wallet: Address)` |

> `get_wallet` is read-only and emits no events.

---

## Querying events

Use the Soroban RPC `getEvents` endpoint, filtering by `contractId` and topic:

```ts
const events = await server.getEvents({
  startLedger: fromLedger,
  filters: [{
    type: "contract",
    contractIds: [CONTRACT_ID],
    topics: [["mux_acct"], ["dlg_set"]],  // [topics[0] filter, topics[1] filter]
  }],
});
```

---

## Security notes

- Events are **append-only** and cannot be modified or deleted after emission.
- Failed operations (those returning an error) do **not** emit events — only successful state changes are logged.
- The `debited` event records the spend amount but not the cumulative total; reconstruct running totals by summing `debited` events between `lmt_set` resets.
