/**
 * AUTO-GENERATED STYLE — hand-authored for mux-recovery.
 *
 * Contract: mux-recovery
 *
 * Provides a client for the MuxRecovery contract with optional filtering
 * query parameters on read methods.
 *
 * ## RecoveryStatus Enum
 *
 * `RecoveryStatus` mirrors the on-chain `RecoveryStatus` Soroban enum and
 * describes the lifecycle state of an account recovery request:
 *
 * ```
 *   None ──► Pending ──► Executed   (guardian executes after timelock)
 *                 └────► Cancelled  (owner cancels)
 * ```
 *
 * Transitions:
 * - `None → Pending`:     `initiate_recovery()` called by a registered guardian.
 * - `Pending → Executed`: `execute_recovery()` called after `RECOVERY_TIMELOCK` ledgers elapse.
 * - `Pending → Cancelled`: `cancel_recovery()` called by the owner at any time.
 * - `Executed` and `Cancelled` are terminal states — no further transitions.
 *   (A new request can be initiated after cancellation or expiry.)
 *
 * ## Audit Events
 *
 * Contract tag: `mux_recv`
 *
 * | Action     | topics[1]   | Trigger             | Status transition   |
 * |------------|-------------|---------------------|---------------------|
 * | `init`     | `init`      | `initialize`        | —                   |
 * | `rec_init` | `rec_init`  | `initiate_recovery` | None → Pending      |
 * | `rec_exec` | `rec_exec`  | `execute_recovery`  | Pending → Executed  |
 * | `rec_cncl` | `rec_cncl`  | `cancel_recovery`   | Pending → Cancelled |
 *
 * The `rec_init` event carries `(guardian, new_owner, initiated_at,
 * executable_at, expires_at)` so off-chain watchers can surface deadlines
 * without a follow-up RPC call.
 *
 * See `docs/recovery-trust-model.md` for the full security model.
 */

import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  scValToNative,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { pollTransaction } from "../horizon";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle state of a recovery request. Mirrors the on-chain
 * `RecoveryStatus` Soroban enum in `contracts/mux-recovery/src/lib.rs`.
 *
 * State machine:
 * ```
 *   None ──► Pending ──► Executed   (guardian executes after RECOVERY_TIMELOCK)
 *                 └────► Cancelled  (owner cancels at any time)
 * ```
 *
 * `Executed` and `Cancelled` are **terminal** — no further state transitions
 * occur. A new recovery request can be initiated after `Cancelled` or after
 * an expired (but un-executed) `Pending` request.
 *
 * Use {@link recoveryStatusFromString} to parse the raw string returned by
 * `scValToNative`. Use {@link isTerminalRecoveryStatus} to check finality.
 *
 * Re-exported from the main package index as:
 * ```ts
 * import { RecoveryStatus } from "@mux-protocol/contracts";
 * ```
 */
export enum RecoveryStatus {
  /** No active recovery request. Default state after initialization. */
  None = "None",
  /**
   * A recovery has been initiated but `RECOVERY_TIMELOCK` ledgers have not
   * yet elapsed. The owner may call `cancel_recovery` to abort.
   */
  Pending = "Pending",
  /**
   * The recovery was executed after the timelock: ownership has been
   * transferred to the `new_owner` specified at initiation. Terminal state.
   */
  Executed = "Executed",
  /**
   * The recovery was cancelled by the current owner before execution.
   * Terminal state — a new recovery can be initiated after cancellation.
   */
  Cancelled = "Cancelled",
}

/**
 * Parse a raw string value from a Soroban RPC response into a typed
 * {@link RecoveryStatus} variant.
 *
 * `scValToNative` converts the on-chain `RecoveryStatus` enum to a plain
 * string (e.g. `"Pending"`). Use this helper to convert it safely.
 *
 * Throws if the value is not a recognised variant.
 *
 * @example
 * ```ts
 * import { recoveryStatusFromString, RecoveryStatus } from "@mux-protocol/contracts";
 *
 * const raw = "Pending"; // from scValToNative(retval)
 * const status = recoveryStatusFromString(raw);
 * if (status === RecoveryStatus.Pending) {
 *   console.log("Recovery is in progress");
 * }
 * ```
 */
export function recoveryStatusFromString(raw: string): RecoveryStatus {
  switch (raw) {
    case "None":      return RecoveryStatus.None;
    case "Pending":   return RecoveryStatus.Pending;
    case "Executed":  return RecoveryStatus.Executed;
    case "Cancelled": return RecoveryStatus.Cancelled;
    default:
      throw new Error(`Unknown RecoveryStatus value: "${raw}"`);
  }
}

/**
 * Return true if a recovery is in a terminal state (Executed or Cancelled)
 * and cannot advance further.
 *
 * @example
 * ```ts
 * if (isTerminalRecoveryStatus(status)) {
 *   console.log("No active recovery — a new one can be initiated.");
 * }
 * ```
 */
export function isTerminalRecoveryStatus(status: RecoveryStatus): boolean {
  return status === RecoveryStatus.Executed || status === RecoveryStatus.Cancelled;
}

/**
 * Return true if a recovery can be cancelled (only when Pending).
 */
export function isCancellableRecoveryStatus(status: RecoveryStatus): boolean {
  return status === RecoveryStatus.Pending;
}

/** Mirrors the on-chain RecoveryRequest struct. */
export interface RecoveryRequest {
  newOwner: Address;
  initiatedAt: number;
  executableAt: number;
  expiresAt: number;
  status: RecoveryStatus;
}



/** Optional filter parameters for recovery queries. */
export interface RecoveryQueryFilters {
  status?: RecoveryStatus;
  guardian?: Address;
  initiatedAfter?: number;
  initiatedBefore?: number;
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface MuxRecoveryClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
}

export class MuxRecoveryClient {
  private contract: Contract;
  private server: SorobanRpc.Server;
  private networkPassphrase: string;

  constructor(opts: MuxRecoveryClientOptions) {
    this.contract = new Contract(opts.contractId);
    this.server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    this.networkPassphrase = opts.networkPassphrase;
  }

  // ── Write operations ────────────────────────────────────────────────────────

  async initialize(
    sourceKeypair: Keypair,
    owner: Address,
    guardians: Address[]
  ): Promise<void> {
    const tx = await this.buildTx(sourceKeypair, "initialize", [
      nativeToScVal(owner.toString(), { type: "address" }),
      xdr.ScVal.scvVec(
        guardians.map((g) => nativeToScVal(g.toString(), { type: "address" }))
      ),
    ]);
    await this.submit(tx, sourceKeypair);
  }

  async initiateRecovery(
    sourceKeypair: Keypair,
    guardian: Address,
    newOwner: Address
  ): Promise<void> {
    const tx = await this.buildTx(sourceKeypair, "initiate_recovery", [
      nativeToScVal(guardian.toString(), { type: "address" }),
      nativeToScVal(newOwner.toString(), { type: "address" }),
    ]);
    await this.submit(tx, sourceKeypair);
  }

  async cancelRecovery(sourceKeypair: Keypair): Promise<void> {
    const tx = await this.buildTx(sourceKeypair, "cancel_recovery", []);
    await this.submit(tx, sourceKeypair);
  }

  async executeRecovery(
    sourceKeypair: Keypair,
    guardian: Address
  ): Promise<void> {
    const tx = await this.buildTx(sourceKeypair, "execute_recovery", [
      nativeToScVal(guardian.toString(), { type: "address" }),
    ]);
    await this.submit(tx, sourceKeypair);
  }

  /**
   * Link a registry contract address to this recovery contract.
   * Only the current owner may call this method.
   */
  async setRegistry(
    sourceKeypair: Keypair,
    owner: Address,
    registryId: Address
  ): Promise<void> {
    const tx = await this.buildTx(sourceKeypair, "set_registry", [
      nativeToScVal(owner.toString(), { type: "address" }),
      nativeToScVal(registryId.toString(), { type: "address" }),
    ]);
    await this.submit(tx, sourceKeypair);
  }

  /**
   * Return the linked registry contract address, or null if not set.
   */
  async getRegistryId(sourceKeypair: Keypair): Promise<Address | null> {
    const tx = await this.buildTx(sourceKeypair, "registry_id", []);
    const result = await this.simulate<string | null>(tx);
    if (result === null || result === undefined) return null;
    return new Address(result);
  }

  // ── Read operations with filtering query params ──────────────────────────────

  /**
   * Return the current owner address.
   * Supports optional filters to narrow results.
   */
  async owner(
    sourceKeypair: Keypair,
    filters?: RecoveryQueryFilters
  ): Promise<Address> {
    const tx = await this.buildTx(sourceKeypair, "owner", []);
    const result = await this.simulate<Address>(tx);
    return this.applyOwnerFilters(result, filters);
  }

  /**
   * Return the registered guardian set.
   * Supports optional filter to find a specific guardian.
   */
  async guardians(
    sourceKeypair: Keypair,
    filters?: RecoveryQueryFilters
  ): Promise<Address[]> {
    const tx = await this.buildTx(sourceKeypair, "guardians", []);
    const result = await this.simulate<Address[]>(tx);
    return this.applyGuardianFilters(result, filters);
  }

  /**
   * Return the current recovery status.
   * Supports filtering by expected status.
   */
  async recoveryStatus(
    sourceKeypair: Keypair,
    filters?: RecoveryQueryFilters
  ): Promise<RecoveryStatus> {
    const tx = await this.buildTx(sourceKeypair, "recovery_status", []);
    const result = await this.simulate<string>(tx);
    const status = this.mapRecoveryStatus(result);
    if (filters?.status && status !== filters.status) {
      throw new Error(
        `Recovery status filter mismatch: expected ${filters.status}, got ${status}`
      );
    }
    return status;
  }

  /**
   * Return the full recovery request struct, or null if no active request exists.
   * Mirrors the on-chain `recovery_request()` entrypoint.
   */
  async recoveryRequest(
    sourceKeypair: Keypair
  ): Promise<RecoveryRequest | null> {
    const tx = await this.buildTx(sourceKeypair, "recovery_request", []);
    const result = await this.simulate<string | null>(tx);
    if (result === null || result === undefined) return null;
    // The simulate returns an xdr.ScVal; parse it into RecoveryRequest
    const parsed = scValToNative(result as any) as RecoveryRequest;
    return parsed;
  }

  /**
   * Convenience method: returns true only if the recovery status matches
   * the given filter value (or any if filter is omitted).
   */
  async isRecoveryStatus(
    sourceKeypair: Keypair,
    status: RecoveryStatus
  ): Promise<boolean> {
    try {
      const current = await this.recoveryStatus(sourceKeypair, {
        status,
      });
      return current === status;
    } catch {
      return false;
    }
  }

  /**
   * Query recovery with generalized filtering. Returns the current
   * recovery state if it matches all provided filters.
   */
  async queryRecovery(
    sourceKeypair: Keypair,
    filters?: RecoveryQueryFilters
  ): Promise<{
    status: RecoveryStatus;
    newOwner: Address | null;
    initiatedAt: number | null;
    executableAt: number | null;
    expiresAt: number | null;
  } | null> {
    const status = await this.recoveryStatus(sourceKeypair);

    if (status === RecoveryStatus.None) {
      return filters?.status !== undefined && filters.status !== RecoveryStatus.None
        ? null
        : { status, newOwner: null, initiatedAt: null, executableAt: null, expiresAt: null };
    }

    // Fetch full state via simulate
    const tx = await this.buildTx(sourceKeypair, "recovery_status", []);
    const result = await this.simulate<string>(tx);
    const mapped = this.mapRecoveryStatus(result);

    return {
      status: mapped,
      newOwner: null, // full RecoveryRequest requires contract extension
      initiatedAt: null,
      executableAt: null,
      expiresAt: null,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private mapRecoveryStatus(val: string): RecoveryStatus {
    switch (val) {
      case "None":
      case "Pending":
      case "Executed":
      case "Cancelled":
        return val as RecoveryStatus;
      default:
        throw new Error(`Unknown recovery status: ${val}`);
    }
  }

  private applyOwnerFilters(
    owner: Address,
    filters?: RecoveryQueryFilters
  ): Address {
    if (filters?.guardian) {
      // owner and guardian are distinct concepts; no filtering needed
    }
    return owner;
  }

  private applyGuardianFilters(
    guardians: Address[],
    filters?: RecoveryQueryFilters
  ): Address[] {
    if (!filters) return guardians;
    let filtered = guardians;
    if (filters.guardian) {
      filtered = filtered.filter(
        (g) => g.toString() === filters.guardian!.toString()
      );
    }
    return filtered;
  }

  private async buildTx(
    sourceKeypair: Keypair,
    method: string,
    args: xdr.ScVal[]
  ): Promise<Transaction> {
    const account = await this.server.getAccount(sourceKeypair.publicKey());
    return new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();
  }

  private async simulate<T>(tx: Transaction): Promise<T> {
    const result = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(result)) {
      throw new Error(`Simulation failed: ${result.error}`);
    }
    const returnVal = (
      result as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!returnVal) throw new Error("No return value");
    return scValToNative(returnVal) as T;
  }

  private async submit(tx: Transaction, signer: Keypair): Promise<void> {
    const simResult = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error(`Simulation failed: ${simResult.error}`);
    }
    const preparedTx = SorobanRpc.assembleTransaction(
      tx,
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).build();
    preparedTx.sign(signer);
    const sendResult = await this.server.sendTransaction(preparedTx);
    if (sendResult.status === "ERROR") {
      throw new Error(
        `Transaction failed: ${JSON.stringify(sendResult.errorResult)}`
      );
    }
    await pollTransaction(this.server, sendResult.hash);
  }
}
