# AI Tutor Canvas — Learn CSS by changing a real page

AI Tutor Canvas turns a learner's own HTML and CSS into a guided visual experiment. Instead of giving away an answer, it helps the learner form a prediction, creates the right hands-on control, watches the real page change, and asks for an explanation that can be tested and transferred.

The result is a different kind of AI learning experience: the conversation and the canvas are one system. A student can say, “I want to change the page color.” The Tutor inspects the imported source, discovers the global --brand token, and creates a color control beside the page. One student choice can then update every component that consumes that token—live, safely, and with a saved before/after comparison.

## See the learning loop

The five-minute submission demo follows one continuous CSS Variables lesson:

1. Import a real HTML/CSS page.
2. Ask the live Tutor for a faster way to explore its global color.
3. Let the Tutor inspect the source and create a page-specific color control.
4. Predict which components will change.
5. Choose a new color and observe the shared visual effect.
6. Explain :root, inheritance, and semantic token naming through ten student–Tutor exchanges.
7. Save the experiment, compare it with the original, and receive a transfer challenge.

The same learning architecture supports box model, Flexbox, and positioning lessons.

## What makes AI Tutor different

- **Tools appear when the lesson needs them.** The Tutor can create a slider or color control from verified source facts, so exploration stays concrete.
- **The learner remains in control.** The Tutor guides prediction and attention; the student makes the consequential edit.
- **Explanations are grounded in the page.** Tutor tools read selected elements, relevant source, computed styles, recent actions, and teaching evidence.
- **Every change is inspectable.** Transient previews stay fast, releases create immutable versions, and comparison makes cause and effect visible.
- **The page runs inside a bounded runtime.** Imports are normalized, scripts are removed, and a versioned bridge mediates inspection and style changes.
- **Learning evidence has a replayable shape.** Learning Proof records versioned lesson events, Tutor states, tool results, saves, and snapshots for later review.
- **Content can travel across languages.** The submission path is fully English, while the importer works with learner-authored pages and multilingual content.

## Run locally

Requirements: Node.js >=24.18.0 <26 and pnpm 10.12.3.

~~~text
pnpm install --frozen-lockfile
pnpm preflight
pnpm dev
~~~

Open http://127.0.0.1:3000. Deterministic learning paths work without an external account. The optional live text-and-voice Tutor uses an existing authenticated local Codex app-server session; the application does not read or store an OpenAI API key.

For the production-style local stack:

~~~text
docker compose up -d --build
docker compose exec -T web /nodejs/bin/node /app/scripts/container-health-check.mjs
~~~

This starts the web app, PostgreSQL, migrations, and a database health check on loopback.

## Validate the project

~~~text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
~~~

Additional browser, accessibility, security, release, and competition checks are available through:

~~~text
pnpm verify:competition
pnpm test:e2e:matrix
pnpm test:e2e:touch
pnpm compliance:check
pnpm audit --prod --audit-level high
~~~

## Repository review guide

- apps/web/src/features/canvas/CanvasWorkspace.tsx — canvas orchestration, lesson selection, import flow, and Tutor-created CSS controls.
- apps/web/src/features/canvas/runtime-project-context.tsx — live previews, color presets, immutable saves, and comparison behavior.
- apps/web/src/features/tutor/server/codex-realtime-provider.ts — the live Tutor's teaching instructions and bounded tool policy.
- apps/web/src/features/tutor/tutor-tool-executor.ts — execution boundary for source reads, evidence reads, and control creation.
- packages/runtime-static-html/src/ — script-free import, sandboxed rendering, and the versioned page-inspection bridge.
- apps/web/src/features/lesson/ — deterministic Predict–Observe–Explain–Transfer lesson engines.
- apps/web/src/features/learning/LearningProofReplay.tsx — unified replay of learning events and saved evidence.
- packages/contracts/src/learning-proof.ts — versioned Learning Proof event contracts.
- tests/e2e/ — real-browser coverage for core learning, recovery, accessibility, security, and failure paths.
- docs/submission/FULL_WRITEUP.md — competition narrative, evidence, operating envelope, and next steps.

## Product configuration and trust

Browser storage supports the local canvas and pending Learning Proof data.
Setting DATABASE_URL enables authoritative PostgreSQL events and snapshots.
Realtime message content is retained only after explicit opt-in; otherwise the
product keeps short-lived operational metadata and labels unsaved replay
content clearly.

Live Realtime checks use an authenticated local Codex app-server session.
Deterministic lessons and text fallback remain available without it. Automated
voice checks run in isolated browser contexts with synthetic microphone tracks,
while the five-minute submission demo captures Tutor audio from the live remote
WebRTC stream.

See .env.example, THIRD_PARTY_NOTICES.md,
docs/PRIVACY_AND_DATA_DISCLOSURE.md, and docs/RELEASE_RUNBOOK.md for
configuration, attribution, privacy, recovery, and rollback details.
