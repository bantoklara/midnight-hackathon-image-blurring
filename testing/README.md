# Testing

How TrueMask is verified, and how to check it yourself in under a minute.

```bash
npm run test:all
```

That single command runs every automated check in the project: contract tests, vision-pipeline
tests, and the full end-to-end trace against the real compiled circuits. No Docker, no wallet, no
network required for any of it.

## What's actually tested, and why it's split this way

| Layer | Where | What it proves |
|---|---|---|
| Contract | `contract/test/truemask.test.ts` | The real compiled Compact circuits (`submit_redaction`, `verify_integrity`, `compute_preserved_root`) behave correctly — including the tamper case, where an altered image must fail verification. |
| Vision — unit | `api/src/test/block-splitter.test.ts`, `hashing.test.ts` | The block grid, bounding-box-to-block mapping, bitmap packing, and hashing are each correct in isolation: outward rounding, edge padding, tamper-changes-the-root, redaction-doesn't. |
| Vision ↔ circuit | `api/src/test/integration.test.ts` | **The single most important test in the project.** It asserts that the root computed in TypeScript (`foldLaneDigests`) is byte-identical to the root computed by the real compiled circuit (`pureCircuits.compute_preserved_root`). If these ever diverge, every proof silently stops verifying while the code keeps compiling and running — this test is what turns that into a loud, immediate failure instead. |
| End-to-end | `testing/e2e-truemask.mjs` | The whole chain on a synthesised photo, no browser and no mocks: detect → grid → redact → hash → the real circuit → a clean verification that passes → a tampered one that fails. |

Contract tests and vision tests run through **vitest**, inside their own workspaces (`contract/`,
`api/`) — they stay there rather than moving into this folder, because moving them would mean
rewriting their relative imports and `tsconfig` wiring for no real benefit. This folder is the map
to all of it, plus the one test that doesn't belong to a single workspace: the end-to-end trace,
which spans both.

## Running things individually

```bash
npm test                    # contract (10 tests) + api (48 tests)
npm run test --workspace contract   # just the contract
npm run test --workspace api        # just the vision pipeline
npm run e2e                 # the end-to-end trace, on its own
```

## The one number that must never move

The end-to-end trace prints the preserved root it computes:

```
✓ [8] computed the preserved root  5bcf866a973e45ce…
```

That value is deterministic for the trace's fixed synthetic input. If a future change to the
hashing construction, the block size, or the circuit ever changes that root, it means every record
already published under the old scheme can no longer be verified. That's the scenario the
vision-↔-circuit integration test above exists to catch before it ships.

## What isn't covered here, and why

- **Face/text detection accuracy.** MediaPipe/Human AI and Tesseract are browser-only (WebAssembly,
  WebGL, a canvas) and can't run in this Node-based suite. Everything *downstream* of detection —
  from a bounding box onward — is fully covered; the detectors themselves were checked by hand in a
  real browser instead (see the root `README.md`'s known-gaps section).
- **Wallet / on-chain publishing.** Verifying an image needs no wallet at all (see `TrueMaskApp.tsx`'s
  verify flow), and that path is exercised end-to-end here. *Publishing* a record is a live
  transaction against Midnight Preprod and can't be part of an automated, offline suite — it was
  tested manually against real infrastructure instead.
