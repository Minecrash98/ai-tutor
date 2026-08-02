# AI Tutor

AI Tutor is a visual learning canvas for CSS beginners. Learners predict an
outcome, edit real HTML and CSS, see the visual cause and effect, explain what
changed, and transfer the idea to a new page.

The current local candidate is P8_IN_PROGRESS. Its 100-item evidence ledger is
75 VERIFIED / 1 IN_PROGRESS / 24 BLOCKED / 0 NOT_STARTED, so the overall
decision remains NO_GO. Automated evidence is not presented as human learning
research, legal review, official competition compliance, or independent
approval.

## What works

- Deterministic Predict–Observe–Explain–Transfer lessons for box model, Flex,
  and positioning.
- Static HTML/CSS import, script removal, sandboxed iframe execution, element
  inspection, CSS controls, safe transient previews, immutable versions, and
  before/after comparison.
- Device-local recovery plus optional PostgreSQL event, snapshot, and unified
  Learning Proof Replay storage.
- Text and voice Realtime Tutor paths with fact-grounded tools and a clearly
  labeled deterministic fallback when an account, network, or microphone is
  unavailable.
- Automated Chrome, Edge, Firefox, WebKit, touch, accessibility, failure,
  security, visual, performance, license, and release checks.

The learning content importer is language-agnostic, and this repository includes
an English CSS variables demo. The current product shell is localized in
Chinese; a complete multilingual interface is future work.

## Run locally

Requirements: Node.js >=24.18.0 <26 and pnpm 10.12.3.

~~~text
pnpm install --frozen-lockfile
pnpm preflight
pnpm dev
~~~

Open http://127.0.0.1:3000. The three deterministic lessons do not require an
external account. The app does not read OPENAI_API_KEY. Optional Realtime paths
use the existing local Codex app-server OAuth session described in
.env.example.

## Run the production-style local stack

~~~text
docker compose up -d --build
docker compose exec -T web /nodejs/bin/node /app/scripts/container-health-check.mjs
~~~

Compose binds only to 127.0.0.1:3000 and starts PostgreSQL, migrations, and a
health check with a real SELECT 1. This is a local release candidate, not a
public deployment. Recovery and rollback instructions are in
docs/RELEASE_RUNBOOK.md.

## Validate

~~~text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
~~~

The most recent complete local baseline passed lint, typecheck, build, 237
tests with 10 account-dependent skips, 67 Chromium E2E cases with 18
account-dependent Live skips, and 25/25 production-style Compose cases.

Additional competition checks:

~~~text
pnpm verify:competition
pnpm test:e2e:matrix
pnpm test:e2e:touch
pnpm compliance:check
pnpm audit --prod --audit-level high
~~~

## Start your review here

- docs/submission/FULL_WRITEUP.md — competition write-up, evidence, limits,
  next steps, and key repository paths.
- docs/submission/REPOSITORY_REVIEW_GUIDE.md — exact implementation and test
  navigation.
- MVP_SPEC.md — frozen learner experience and acceptance boundaries.
- ARCHITECTURE.md — runtime, data, trust, and Realtime architecture.
- COMPETITION_FIRST_PLACE_GOALS.md — 100-item execution and evidence ledger.
- docs/RESULTS_AND_LIMITATIONS_2026-08-02.md — measured machine results and
  explicit non-claims.
- docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md — unified replay
  acceptance evidence.

## Data, external services, and licenses

The current canvas and pending Learning Proof data use browser storage.
Providing DATABASE_URL enables authoritative PostgreSQL events and snapshots.
Realtime content is retained for at most seven days only after explicit opt-in;
without opt-in, content remains null and only short-lived metadata is stored.

The project uses the pinned tldraw 3.15.5 free path with visible watermark; no
commercial license is claimed. See THIRD_PARTY_NOTICES.md,
docs/PRIVACY_AND_DATA_DISCLOSURE.md, licenses/, and the SBOM files under
evidence/.

No secrets belong in this repository. Copy .env.example for local configuration
and never commit credentials, API keys, OAuth material, or personal data.

## Honest limitations

No unfamiliar student pilot, CSS/pedagogy expert review, human screen-reader
study, real-device matrix, official competition-rule mapping, legal opinion,
second-machine rehearsal, or independent go/no-go review has been completed.
The user also waived a new 30-minute soak run, so goal 083 remains
IN_PROGRESS. Those gaps remain blocked rather than being replaced by automated
claims.
