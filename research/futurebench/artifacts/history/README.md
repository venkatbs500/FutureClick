# SUPERSEDED PRE-FINAL-TEST PREREGISTRATIONS

**Nothing in this directory is active.** These are retained canonical bytes of
preregistration versions that were replaced before any sealed partition was opened.

They exist for one reason: so a recorded historical freeze hash can be **recomputed**
rather than taken on trust. An amendment that names a superseded hash without retaining
the bytes is an assertion; retaining the bytes makes it evidence.

| File | Version | SHA-256 | Superseded by |
| --- | --- | --- | --- |
| `fc008-preregistration-v1.0.json` | 1.0 | `cc108565d519885599d1cc40a8f99a392049c1bac1520d5e664ee9109752dc7f` | amendment 1 → v1.1 |
| `fc008-preregistration-v1.1.json` | 1.1 | `4b2cbbb1a9da3bb8479be5c517316762b0417210efe4bb5ca6f7ae290aec4b1c` | amendment 2 → v1.2 |

Verify with:

```sh
shasum -a 256 fc008-preregistration-v1.0.json
```

## These files can never authorize final evaluation

The separation is structural, not a naming convention. The artifact manifest records
these under `auditHistory`, and the unlock path resolves artifacts by searching the
manifest's `artifacts` list only — so a file listed here is unreachable from
authorization rather than merely discouraged. `load_frozen_research_identity` also
refuses outright if the active preregistration hash ever appears among the audit-history
entries, so a future change that merged the two lists fails loudly instead of quietly
authorizing against an amended-away protocol.

Both amendments were authorization-integrity corrections made **before** the final-test
partitions were opened. Neither changed a research question, a metric, the C grid, a
temperature, a threshold, the dataset, or the partitions. See the `amendments` array in
the active preregistration for the full record.

## Do not edit

These bytes are copied, never regenerated. Regenerating a superseded document from
current source would defeat the point of keeping it. The artifact pipeline verifies each
file still hashes to its declared value and fails closed if it does not.
