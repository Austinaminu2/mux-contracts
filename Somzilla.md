Issue:#396 Define recovery request storage struct

Context
Soroban contracts should harden recovery struct. Issue 'Define recovery request storage struct' tracks a concrete improvement so Mux on-chain behavior stays auditable, bounded in storage, and easy to bind from TypeScript.

Tasks
Implement or document recovery struct in the relevant contract crate or script
Keep changes no_std-safe and aligned with existing error enums
Add or update Rust unit tests or script checks where behavior changes
Update contracts docs or bindings notes if the public interface changes
Acceptance Criteria
Recovery struct is implemented or documented as specified
cargo test and clippy remain green for touched crates
Storage growth stays bounded where collections are involved
Public entrypoints and errors stay consistent with existing patterns