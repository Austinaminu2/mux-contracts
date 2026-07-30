/**
 * Smoke-tests for the MuxRecoveryClient, RecoveryStatus, filtering query
 * params, and the exported recovery timelock constants.
 */

import {
  MuxRecoveryClient,
  RecoveryQueryFilters,
  RecoveryStatus,
  recoveryStatusFromString,
  isTerminalRecoveryStatus,
  isCancellableRecoveryStatus,
} from "../src/generated/mux-recovery";
import {
  RECOVERY_TIMELOCK_LEDGERS,
  RECOVERY_EXPIRY_LEDGERS,
} from "../src/types";

describe("MuxRecoveryClient filtering query params", () => {
  it("exports MuxRecoveryClient class", () => {
    expect(MuxRecoveryClient).toBeDefined();
    expect(typeof MuxRecoveryClient).toBe("function");
  });

  it("exports RecoveryStatus enum with all variants", () => {
    expect(RecoveryStatus.None).toBe("None");
    expect(RecoveryStatus.Pending).toBe("Pending");
    expect(RecoveryStatus.Executed).toBe("Executed");
    expect(RecoveryStatus.Cancelled).toBe("Cancelled");
  });

  it("RecoveryRequest interface includes expiresAt field", () => {
    // Verify the interface shape compiles and carries expiresAt.
    const req: import("../src/generated/mux-recovery").RecoveryRequest = {
      newOwner: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as any,
      initiatedAt: 1000,
      executableAt: 17280,
      expiresAt: 120960,
      status: RecoveryStatus.Pending,
    };
    expect(req.expiresAt).toBe(120960);
  });

  it("RecoveryRequest null defaults include expiresAt", () => {
    // When no recovery is active, all fields should be null including expiresAt.
    const req = {
      status: RecoveryStatus.None,
      newOwner: null,
      initiatedAt: null,
      executableAt: null,
      expiresAt: null,
    };
    expect(req.expiresAt).toBeNull();
  });

  it("exports RecoveryQueryFilters type", () => {
    const filters: RecoveryQueryFilters = {
      status: RecoveryStatus.Pending,
    };
    expect(filters.status).toBe(RecoveryStatus.Pending);
  });

  it("supports filtering by guardian address", () => {
    const filters: RecoveryQueryFilters = {
      guardian: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as any,
    };
    expect(filters.guardian).toBeDefined();
  });

  it("supports filtering by ledger range", () => {
    const filters: RecoveryQueryFilters = {
      initiatedAfter: 1000,
      initiatedBefore: 2000,
    };
    expect(filters.initiatedAfter).toBe(1000);
    expect(filters.initiatedBefore).toBe(2000);
  });

  it("combines multiple filter params", () => {
    const filters: RecoveryQueryFilters = {
      status: RecoveryStatus.Executed,
      initiatedAfter: 500,
    };
    expect(filters.status).toBe(RecoveryStatus.Executed);
    expect(filters.initiatedAfter).toBe(500);
  });
});

// ── Recovery timelock constants (closes #398) ─────────────────────────────────

describe("Recovery timelock constants", () => {
  it("RECOVERY_TIMELOCK_LEDGERS equals the on-chain constant 17_280", () => {
    expect(RECOVERY_TIMELOCK_LEDGERS).toBe(17_280);
  });

  it("RECOVERY_TIMELOCK_LEDGERS represents ~24 hours at 5-second ledger close", () => {
    const seconds = RECOVERY_TIMELOCK_LEDGERS * 5;
    expect(seconds).toBe(86_400); // 24 * 60 * 60
  });

  it("RECOVERY_EXPIRY_LEDGERS equals the on-chain constant 120_960", () => {
    expect(RECOVERY_EXPIRY_LEDGERS).toBe(120_960);
  });

  it("RECOVERY_EXPIRY_LEDGERS represents ~7 days at 5-second ledger close", () => {
    const seconds = RECOVERY_EXPIRY_LEDGERS * 5;
    expect(seconds).toBe(604_800); // 7 * 24 * 60 * 60
  });

  it("RECOVERY_EXPIRY_LEDGERS is greater than RECOVERY_TIMELOCK_LEDGERS", () => {
    expect(RECOVERY_EXPIRY_LEDGERS).toBeGreaterThan(RECOVERY_TIMELOCK_LEDGERS);
  });

  it("can compute executableAt from initiatedAt without an RPC call", () => {
    const initiatedAt = 500_000;
    const executableAt = initiatedAt + RECOVERY_TIMELOCK_LEDGERS;
    const expiresAt = initiatedAt + RECOVERY_EXPIRY_LEDGERS;
    expect(executableAt).toBe(517_280);
    expect(expiresAt).toBe(620_960);
    expect(expiresAt).toBeGreaterThan(executableAt);
  });
});
