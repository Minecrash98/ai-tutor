# English narration script

## 00:00–00:18

CSS is visual, but learning it often feels disconnected. A learner changes a
line, sees a different page, and still does not know why. AI Tutor turns that
gap into a guided experiment: predict, observe, explain, and transfer.

## 00:18–00:38

We begin with a real, self-contained HTML and CSS exercise. It is imported
into the visual canvas, normalized, and rendered inside a sandbox. Uploaded
scripts do not execute. The lesson itself is in English even though the
current prototype shell is localized in Chinese.

## 00:38–01:16

This page uses global CSS color variables. The purple brand color is declared
once in the root selector, then reused by the label, button, borders, and code
highlights. The surface, text, accent, and border colors follow the same
pattern. A learner can inspect the page as a system instead of hunting through
unrelated declarations.

## 01:16–02:02

Now we open the source. The HTML structure remains unchanged, because the
learning goal is theme control, not markup editing. In theme dot CSS, the
important values are grouped at the top. Components below read those values
through the var function. This makes the causal relationship visible before
we edit anything.

## 02:02–02:40

First, we change only the brand token from purple to deep teal. The editor
selects the exact value, applies the change, and runs a safe preview. One edit
updates every component that references the token. This is the key idea:
global variables reduce repetition and make design decisions explicit.

## 02:40–03:25

Next, we extend the change into a complete mint theme. Surface, card, text,
muted text, accent, and border tokens are updated while component rules stay
untouched. The preview shows the whole page changing coherently. AI Tutor is
not generating a final answer behind the learner's back; it exposes the source,
the action, and the visible result.

## 03:25–03:58

After the preview succeeds, we give the change a meaningful name and save it
as a new immutable version. A failed or unsafe edit would not replace the last
known good result. That separation between transient preview and committed
version supports experimentation without losing the learner's work.

## 03:58–04:25

The canvas now keeps both the original purple version and the mint version.
Comparison is more than presentation polish: it helps the learner explain
which token changed, where it was reused, and why multiple components moved
together. The same approach supports box model, Flex, positioning, and
personalized lessons derived from imported pages.

## 04:25–05:00

Behind the lesson, versioned Learning Proof can replay course events, tutor
messages, tool results, fact receipts, and canvas saves on one timeline.
Machine tests cover the workflow, recovery, security, visual states, and
authoritative PostgreSQL replay. Human learning research is still pending, so
we do not claim proven outcomes. Next, we would run a preregistered learner
pilot, complete interface localization, and validate on more devices and
networks. AI Tutor's goal is simple: help learners see the cause, explain the
effect, and carry the idea to the next page.
