# Repository Agent Contract

## Source of truth

Read these files before changing implementation scope:

1. `MVP_SPEC.md`
2. `ARCHITECTURE.md`
3. `IMPLEMENTATION_PLAN.md`

## Phase gate

The currently authorized phase is recorded at the top of `IMPLEMENTATION_PLAN.md`.

Do not implement a later phase until the user explicitly approves it.

P3 is complete: static HTML/CSS import, normalization, sandboxed iframe
execution, the versioned bridge protocol, and runtime lifecycle are active.

P4 element selection and style inspection are complete. P5 CSS controls,
comparison, immutable versions, and device-local recovery are complete. P6
Realtime AI and the box-model vertical learning loop were explicitly approved
by the user on 2026-08-02 after machine-verifiable acceptance. The minimum P7
scope—versioned learning-evidence events, authoritative persistence, and
Learning Proof Replay—also has machine-verifiable acceptance evidence and
explicit user approval. The active phase is P8; deployment, external user
research, and all later phases are authorized. Purchases are explicitly
excluded: do not buy licenses, services,
devices, ads, or participant incentives. Never replace missing human, legal, or
competition evidence with machine evidence.

## Required validation

For the current P8 baseline, run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Account-dependent Live tests must use a fresh isolated browser context, fake
microphone input, and `--mute-audio`; never access the physical microphone.
Report real command results and keep machine evidence, human approval, and
blocked external work explicit.
