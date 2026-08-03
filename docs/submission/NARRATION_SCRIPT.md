# English narration script — Demo v2

Voice: local Piper `en_US-lessac-high`; 801 words; approximately 170 words
per minute. The final card remains on screen without narration from 04:43 to
05:00.

## 00:00–00:20 — The learning claim

Most CSS tutorials tell you what a custom property is. AI Tutor makes you prove
what it does. In the next five minutes, a student will import a real page, ask
the Tutor a question, make a prediction, change one global color token, and
compare the result with the original. Everything you see is running in the real
product, inside a fresh browser session.

## 00:20–00:45 — Import a real exercise

We begin with two ordinary files: index dot HTML and theme dot CSS. AI Tutor
normalizes the upload, removes executable scripts, and renders the page inside
a sandboxed frame. The exercise is deliberately small, but it is not a
screenshot or a mockup. The button, cards, borders, labels, and code highlights
are all live HTML and CSS. The interface and lesson are presented in English
for this recording.

## 00:45–01:08 — Semantic tokens

The purple theme is controlled by custom properties in the root selector.
Names such as brand, surface, text, accent, and line describe design roles
instead of individual components. That is the first useful pattern: choose
semantic token names. A token called brand can serve a button, an eyebrow
label, a border, and a code highlight. A name such as purple button would lock
the variable to one color and one component.

## 01:08–01:38 — Scope, inheritance, and fallbacks

Now we open the actual source. Root gives these tokens page-wide scope. Custom
properties participate in the cascade, and descendants inherit them unless a
closer declaration wins. Components consume a token with the var function,
while an optional second argument can provide a fallback. The code highlight
also uses color mix, deriving a softer tint from brand instead of introducing
another unrelated literal. So the page already exposes a small design system:
centralized decisions at the top, reusable component rules below.

## 01:38–02:06 — Real student–AI Tutor interaction

Before editing, the student opens the AI Tutor and asks a specific question:
if brand changes, which visible parts should move together, and why? The Tutor
does not need to take over the keyboard. It checks the current canvas and
source, responds in English, and asks the learner to predict the effect. The
student answers that every rule reading var brand should update, while text and
surface tokens should stay unchanged. This interaction matters: the AI is
guiding an observable claim, not merely producing a definition.

## 02:06–02:31 — Change one token

With that prediction recorded, we change only brand, from purple to deep teal,
and run a safe preview. Watch the same value propagate to the primary button,
the eyebrow label, the hero border, the token board, and the code emphasis. The
HTML has not changed. The component selectors have not changed. One decision
moved through every consumer because each rule points back to the same token.
That is the cause-and-effect link the learner predicted.

## 02:31–02:53 — Ground the explanation

The Tutor can now ground the explanation in the visible result: the edited
value, the affected target, the matching rule, and the current revision. If
those facts do not line up, the product is designed to say that evidence is
missing instead of inventing a confident explanation. The student still
performs the edit. AI provides a question, a bounded inspection, and feedback;
it does not silently complete the learning task.

## 02:53–03:21 — Build a complete palette

Next we build a complete mint palette. Brand soft, page surface, card surface,
primary text, muted text, accent, and border tokens change in one compact
section. Notice what stays stable: the HTML structure, layout, spacing, and
component rules. This is why global variables scale beyond a single trick.
They separate design decisions from component implementation, make themes
easier to audit, and reduce the risk of leaving one hard-coded color behind.

## 03:21–03:47 — Preview and preserve

The editor distinguishes a transient preview from a committed version. We run
the candidate first. If the CSS is invalid or unsafe, the last known-good
rendering remains available. When the preview succeeds, we give it a meaningful
name and save an immutable revision. The original purple page is not
overwritten. That makes experimentation recoverable: a learner can try,
inspect, fail safely, correct the code, and still return to a known state.

## 03:47–04:15 — Compare and replay

Finally, AI Tutor places the original and mint versions together. The
comparison turns a visual impression into an explanation: which token changed,
which consumers responded, and which properties remained constant. The same
evidence model supports lessons on the box model, Flexbox, and positioning.
Versioned Learning Proof can replay student steps, Tutor messages, tool results,
fact receipts, and canvas saves on one timeline, while keeping machine evidence
separate from human learning outcomes.

## 04:15–04:43 — Honest scope and closing

This recording shows implemented product behavior. It does not claim that a
learner study has already proved better outcomes; that research is still
pending. Realtime Tutor also depends on an authenticated local Codex service,
while deterministic lessons remain usable offline. The core idea is
straightforward: let the student predict, let the page reveal the effect, let
the Tutor ground the explanation, and then preserve enough evidence to revisit
what actually happened. Change once, understand everywhere.

## 04:43–05:00 — Closing card

No narration. The closing message remains visible for review.
