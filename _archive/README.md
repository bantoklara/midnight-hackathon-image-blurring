# Archive

Superseded files, kept for history. Nothing here is compiled, imported, or tested.

## `ImageVerification.compact`

The original BoundingBox-scheme contract from the frontend prototype. Archived because:

1. **It does not compile.** `get_redaction_boxes(): List<BoundingBox>` is illegal — `List<T>` is a
   ledger-only ADT in Compact and cannot be a witness return type. It also writes
   `verified_images.insert(redacted_hash, true)` without the required `disclose()`.
2. **The scheme it implements is retired.** TrueMask now uses the block/Merkle-style
   redaction-integrity scheme in `contract/truemask.compact`: the image is split into a fixed grid,
   a root is committed over the blocks that were *not* authorized to change, and integrity is
   checked by recomputing that root. See `api/src/vision/README.md`.

The live contract is `contract/truemask.compact`. Do not resurrect this file.
