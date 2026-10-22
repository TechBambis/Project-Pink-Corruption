# Shared character and spoken output

`Bambi Companion · focused` is an additional selectable character in
`packages/content/companion.ts`. Classic, Gentle, English Conversation and Custom
remain available; their authored documents and provenance are preserved.

`packages/ai/character.ts` resolves the complete selected character for warmup,
chat, event narration and Guided scenes. The shared identity and address policy
live in `packages/content/voice.ts`: Owner is the external adult female speaker;
Bambi's inner response uses the imagined listener's feminine first-person
perspective. An inner response is never actual listener evidence.

The existing stored `guided-style` preference now supplies the shared
`narrationStyle` field to chat as well as Guided. Its control is under Voice's
Shared speaking style. There is one active style value. Selecting a built-in
character no longer leaks the saved Custom persona through Situational metadata.
Changing character/style invalidates pending Guided preparation through the
existing settings signature and generation epoch. Already heard history is never
rewritten. Prepared playback retains its existing owned boundary.

## Output admission

Language freedom is now unconditional in `packages/ai/language-style.ts` for
chat, warmup, Guided and event speech. Its shared instruction permits uncensored
profanity and explicit vocabulary according to the selected character and user
request. It does not declare an ordinary question to be a roleplay scene.
There is no UI toggle. Old `rawRoleplay`, `nsfw` request flags and `raw-roleplay`
backup values remain readable for compatibility and cannot disable this rule.

## Prompt ownership after simplification

The reusable prefix contains the complete selected character, concise shared
language/role/evidence rules, saved style, reply purpose, optional Situational
header syntax and unconditional language freedom. It contains no app-added
breath/pause examples. Legacy character documents may still contain their own
examples; the current output contract explicitly owns their permitted format.

Chat has one current output contract. Narration and breathing-related chat use the private paced
breath protocol; unrelated conversation gets no breathing examples; adaptive delivery supplies engine-owned gaps instead, without
conflicting breath/pause examples. Guided uses breath action fields and events
use plain speech windows. Both retain their existing compiler and audio clocks.
The Custom reactive chat's explicitly requested validated scene action remains
available. Situational speech does not acquire device or presentation actions.

`replyWordBudget` supplies the single current word range to both prompt wording
and the runtime completion guard: an active engine delivery budget, otherwise
an explicit word request or the selected focused/Situational/phase default. Engine delivery retains final
authority over its bounded window. Warmup now includes adaptive delivery and
checks representative positions in all five phases. Session facts appear once;
Situational guidance only chooses the contribution/header. The phase config
contains phase purpose and delivery intensity, not another word target, marker
protocol or independently imposed explicit-language theme. The selected
character, shared style and actual request determine vocabulary.

Memory facts/excerpts remain separate bounded candidates for context fitting;
their evidence rule appears once in the shared prefix rather than before every
record. Guided feedback and committed cycle counts appear in its data object
once. Legacy full-plan mode also receives a concise format explanation instead
of a duplicate serialized decoder schema. The same full schema and semantic
validation still constrain the backend response.

Focused English drafts constrain their advertised maximum of 20 whitespace-
separated spoken words per field in the decoder grammar and check it again
before TTS, inside the existing one-retry allowance. Compact local planning uses
at most two model actions; other first drafts may use four. This prevents known
slow-voice overflows earlier without cutting a sentence. The measured 20-second
PCM ceiling remains authoritative; short text alone cannot guarantee duration.

Chat now uses `packages/ai/spoken-blocks.ts`: each newline-terminated `[owner]`
or enabled `[bambi]` line is one atomic spoken thought. Native decoding enforces
this framing, sentence endings, enabled marker families and a finite line budget.
Explicit sentence/question counts override the normal ceiling of six lines for
conversation; narration uses its current word budget. Continuations retain the
remaining budget and may select EOS. A situational ask emits one question and
yields instead of synthesizing an answer. Incomplete lines and outside prose
never reach the display or voice; completed earlier lines remain usable.

Other backends receive the same format instruction and strict parser, without
a native grammar guarantee. Guided plans and individual event narration retain
their existing JSON/plain-text speech contracts rather than chat role tags.
The existing audio engine still owns parallel inner playback and Stop epochs.
Framing alone cannot determine whether words inside a valid line are narration.

`packages/speech/contract.ts` validates generated speech before public release.
Chat holds completed speech units, validates them, and releases the same accepted
text to both the UI and the existing bounded TTS queue. It preserves incremental
generation across complete sentences, Voice routing, acknowledgments and
heard-only history. Incomplete comma clauses no longer start speech on their own.

One `SpokenOutputGate` per request permits at most one corrective generation,
using the same backend, model, complete character and inference queue. The repair
uses a single text field on structured backends, avoiding conflict with the
normal role-line format. A transport-only fallback is retained for other backends.
The repair deadline begins after acquisition of that queue. Stop cancels queued work and
prevents a delayed replacement from committing. A failed replacement discards
the remaining uncommitted output and reports `audioComplete:false`; it cannot
automatically restart narration. Valid audio already committed can finish.

Guided plans and individual event texts call the same validator inside their
existing one-retry boundary, before synthesis. The address check rejects the
explicitly undesired standalone `pet`; it does not censor profanity or change
words after they were heard. A narrowly scoped literal definition/translation
request may discuss that term. Some clear Owner self-narration and known broken
sentence endings are also rejected. A long copied guide passage is rejected
when it repeats heard text and the listener did not request repetition.

For a structurally decoded Guided plan rejected for one copied guide sentence,
the existing second attempt rewrites only that action's text. Its ID, look and
other action fields remain fixed and are provided to the repair. The entire plan
is validated again, including cue grounding, duration and repetition. This still
uses at most two attempts; a second invalid candidate is not admitted.

Inner speech cannot address Bambi/doll as another person. These checks are deliberately limited and
do not guarantee semantic role fidelity or natural language quality in general.

The shared gate also rejects narrowly identified first- and third-person stage directions
such as `I lean in close`, `my lips brushing`, `Her eyes narrow` or `She steps closer`, including narration mixed with
quoted dialogue. It requests one spoken replacement before release; it does not
blindly extract every quoted span or strip action words from an accepted line.
Explicit explanation of a narration example can quote it. The browser regression
checks that rejected first- and third-person prose reaches neither the UI nor TTS. This is
still a targeted language check, not proof that every possible narrative form
will be identified.

When constructing model history, `spokenHistoryMessages` excludes assistant
turns containing the same recognized stage directions. User messages, valid
speech, request-scoped prose explanations and the stored visible conversation
are retained. This prevents an earlier malformed answer from becoming another
spoken example; it does not rewrite summaries or retrieved reference excerpts.

The TypeScript speech script and final Python speech boundary remove double
quotation delimiters while preserving the enclosed words and apostrophes.
Otherwise a closing quote after a sentence can become a separate punctuation-only
render, producing a stray sound or unnecessary pause. Quote-only streaming tails
make no speech request. This does not extract dialogue from rejected narration.

Live Kokoro speech keeps commas and semicolons within each bounded sentence,
so addressing the listener as `..., Bambi, ...` does not add separate renders
and preset silence at each comma. Explicit pause markers remain authoritative.

Bare `Bambi` is ordinary listener address in event validation **and** the native
event grammar. Explicitly scheduled Bambi cues remain available. Compound cue
phrases still require their dedicated engine actions.

## Focused Guided drafts

For the focused character, the model returns a small draft with `strategy`,
`actions` and optional `openThreads`/`resolution`. Each action has its existing
kind-specific fields; look changes, delivery and pauses are optional. The model
does not generate IDs, sections, rationale, repeated full looks or timestamps.

`packages/session-director/regie/draft.ts` builds the structured decoder schema
from the same admitted action variants and expands the draft into the existing
complete scene contract. A current look is supplied as context; only explicitly
requested allowed look changes replace it. Engine-generated IDs and defaults do
not authorize capabilities. Existing phase, pool, grounding, challenge, measured
PCM and compiler checks still run before the complete scene can commit.

The prompt explains action fields without embedding the full serialized schema.
The backend receives the schema separately. It can request up to four actions,
or at most two on the single compact retry. Spoken fields have room to finish a
thought naturally; the actual 20-second PCM ceiling still applies. Explicit
inhale/exhale pacing belongs only in breath step fields, never in preparation or
ordinary guide text. General references to natural breathing remain possible.
An explicitly requested count of one to three breath cycles constrains the
decoder and is checked again against the total compiled plan.

An independent committed-cycle ledger prevents that request from scheduling
the same count again in the following lookahead window. It survives pruning of
the four-entry narrative outlook. Invalidated, uncompleted sections release
their reservations; new feedback starts a fresh count. Completion follows the
existing observed section boundary and is not evidence of physical breathing.

Guided inner arcs now use the existing distinct Bella/Heart synthesis path.
The compiler still owns their timed inner playback track; continuous chat keeps
its existing parallel mixer.

## Verification

- `tests/spoken-contract.test.ts`: rejection, unfiltered vocabulary, withheld
  replacement, one-repair limit, voice route and cancellation.
- `tests/character.test.ts`: full Classic preservation, focused character,
  shared style and inactive Custom persona.
- `tests/regie.test.ts`, `tests/session-events.test.ts`: draft expansion,
  inherited looks, capability rejection, cue/name consistency and plan retries.
- `scripts/high-impact-browser-check.mjs`: deliberately split bad address,
  no rejected UI/TTS output, repeated failure and Stop during repair, alongside
  existing chat, interruption and playback regressions.
- `BAMBI_REGIE_FOCUSED=1 BAMBI_REGIE_REAL_TTS=1 node scripts/regie-browser-check.mjs`:
  focused draft, rejected first address, real installed Kokoro synthesis, measured
  In/Out display, background restoration and Stop, using simulated model output
  and no physical speaker/device output.

Production-model measurements are separate from fixture correctness. Record
context tokens, preparation time, playable seconds and actual text. Continuous
generation needs to produce playable material faster than it is consumed; a
larger buffer alone cannot meet that condition. Model quality and physical audio
latency require their own observations.

Moving an uncommitted scene preserves fractional PCM durations. Re-associating
absolute timestamp sums can leave adjacent boundaries a floating-point bit
apart. Program admission therefore uses the existing parent-phase tolerance
of 0.001 ms for foreground adjacency and response/prompt boundaries as well.
This does not move events or clip audio; actual overlaps remain invalid.
The fractional-PCM regression reproduces the former rejection after placement
and checks that a 1 ms overlap is still rejected before runtime commitment.
