# AI Tutor Canvas — Full write-up

## The problem and our approach

CSS is visual, but most AI help still arrives as text to copy. That can finish
a task without helping a learner connect code, cause, and visible effect. AI
Tutor Canvas brings the conversation onto the rendered page so a student can
predict an outcome, run an experiment, observe the evidence, explain the
mechanism, compare versions, and transfer the idea.

The central contribution is a Tutor that can create the right learning
instrument from verified page facts. In the submission demo, a student imports
a small HTML/CSS design system and asks to change its page color. The live
Tutor reads the source, finds the global --brand custom property under :root,
and creates a compact color control bound to that declaration. The student—not
the AI—chooses Mint. Buttons, labels, borders, code highlights, and a mixed
shadow change together while spacing and structure stay fixed.

Across ten student–Tutor exchanges, the learner predicts which consumers will
change, checks the synchronized result, explains why one token reaches several
components, distinguishes color from layout, explores :root inheritance,
reasons about a nearer override, chooses a semantic token name, and receives a
transfer challenge. An abstract definition becomes a visible, testable claim.

The canvas keeps this loop concrete and recoverable. Imported HTML and CSS are
normalized, executable scripts are removed, and the page runs in a sandboxed
iframe behind a versioned bridge. Controls provide immediate transient
feedback; committing creates an immutable version. The original remains
available for side-by-side comparison.

The live Tutor operates through bounded teaching tools. It can read the canvas,
relevant source, computed styles, recent actions, and learning evidence; it can
create a focused control or comparison when the lesson calls for one. Learning
Proof then records versioned lesson steps, Tutor states, tool results, evidence
receipts, and saves. A unified replay reconstructs the sequence, while
PostgreSQL persistence validates owner, order, hashes, idempotency, and
snapshots.

## Evidence, experiments, and user testing

The five-minute submission video runs against the real application in a fresh
isolated Chrome profile. A scripted student sends ten prompts to an
authenticated live voice Tutor and receives ten captured Tutor responses. The
recording verifies that the Tutor creates a controller for :root --brand, the
student changes the value from #6750a4 to #0f9f8f, the real iframe updates, a
new version is saved, and comparison opens. Tutor audio comes directly from
the remote WebRTC track; student and narrator voices are generated locally.

The capture checks visible text, accessibility attributes, form values,
selected options, document language, iframes, and CSS pseudo-elements for an
all-English presentation. It uses a generated silent microphone source and
muted browser output, so no physical microphone is accessed.

The final current-source baseline passes lint and type checking across six
workspace packages, 246 unit and integration tests with 10 account-dependent
skips, the optimized production build, and 67 Chromium end-to-end tests with
18 Live capability skips. Those suites cover contracts, sandboxing, source
grounding, lessons, immutable versions, Learning Proof, recovery,
accessibility, security, and failure paths.

A controlled local performance run measured import P95 at 340 ms,
pointer-frame P95 at 16.8 ms, and drag-preview P95 at 23.3 ms across 47 preview
samples. This evidence establishes the implemented behavior and interaction
budget. A learner pilot is the next measurement layer for conceptual transfer
and retention.

## Constraints, limitations, and incomplete areas

Deterministic lessons run locally without an external account. Live voice and
text tutoring use an existing authenticated local Codex app-server session.
The product has English and Chinese presentation paths; a first-class in-app
language switch is the next localization upgrade.

The repository supports local and Docker evaluation. A public production
release would add hosted authentication, rate limiting, observability,
retention controls, and applicable production licenses. Scripted student
prompts make the demo repeatable; they demonstrate a working live interaction,
not a human learner outcome study.

## What we would improve next

Next, we would add a teacher-facing authoring system for concepts, predicted
invariants, safe controls, and transfer tasks. We would add the language
switch, more semantic CSS topics, adaptive challenges from Learning Proof
history, and a hosted classroom path. A preregistered learner pilot would
measure task completion, near and far transfer, and delayed retention,
followed by expert rubric and human accessibility review.

## Repository review guide

- apps/web/src/features/canvas/CanvasWorkspace.tsx — project import, lesson
  orchestration, and source-verified Tutor controls.
- apps/web/src/features/canvas/runtime-project-context.tsx — live color
  control, transient preview, immutable saves, and comparison.
- apps/web/src/features/tutor/server/codex-realtime-provider.ts — live Tutor
  teaching behavior and bounded tool policy.
- apps/web/src/features/tutor/tutor-tool-executor.ts — grounded reads, control
  creation, and focus actions.
- packages/runtime-static-html/src/sandbox-document.ts — executable-content
  removal and sandbox construction.
- packages/runtime-static-html/src/inspection-bridge.ts — versioned inspection
  and style messages.
- apps/web/src/features/lesson/ — deterministic
  Predict–Observe–Explain–Transfer state machines.
- apps/web/src/features/learning/LearningProofReplay.tsx — unified learning
  timeline replay.
- apps/web/src/features/learning/server/learning-proof-store.ts — authoritative
  event and snapshot persistence.
- packages/contracts/src/learning-proof.ts — versioned evidence contracts.
- tests/e2e/ — real-browser learning, recovery, accessibility, security,
  performance, and failure coverage.

Run pnpm install --frozen-lockfile, pnpm preflight, and pnpm dev, then open
http://127.0.0.1:3000. Validate with pnpm lint, pnpm typecheck, pnpm test, pnpm
build, and pnpm test:e2e.

The only simulated media input is the silent microphone used by isolated
browser automation; Tutor responses in the final demo are live. Realtime is
the only external-service-dependent path. No passwords, API keys, browser
profiles, personal data, or learner records are committed.
