---json
{
    "title": "The Untrodden Path: Building a Language, and a Parser Generator in It, with AI Agents",
    "date": "2026-07-16",
    "author": "FUJI Goro",
    "description": "In January 2026 I started building a programming language with 100% agentic coding. Six months and ~1,450 pull requests later, the largest program written in it beats ANTLR4 — in a language no model was ever trained on.",
    "tags": [],
    "index": true
}
---

In January 2026 I started building a programming language. Six months on, I
still haven't written any of the compiler myself. It's 100% pure agentic coding.

Wado is a Rust-like, statically-typed, garbage-collected language for
WebAssembly's Component Model. AI agents wrote every line; I steered, mostly from my phone, in
the gaps of a day with two small kids — sample programs and the odd test,
nothing more. About 1,450 merged pull requests later, the largest program
written in Wado is **Gale**, an ANTLR4-compatible parser generator. On the same
SQLite grammar, a Gale parser runs roughly **88× faster** than ANTLR4's own
Java, and its highlighter beats tree-sitter.

Here's the part I still can't get over: no model was ever trained on Wado. It
didn't exist before this year. Every line of Gale is written in a language the
agent learned on the spot — from the compiler's own error messages and a spec we
wrote as we went. Large software, in a language unknown to the machine writing
it. The untrodden path, twice over.

## I like languages more than I like programming

I love programming languages — not just writing in them, but looking at them,
the way some people love buildings they'll never live in. I read grammars for
fun.

Programming is my day job — I run engineering at a startup — but languages were
always the hobby on the side. Then the kids arrived and even that stopped. So
earlier this year, half out of curiosity, I opened an agentic coding tool with a
single thought: let's design a language. My ideal language —
something like Rust but easier, as easy to reach for as TypeScript, and fitted
to this exact moment. Target only WebAssembly. No — don't just target Wasm; take
it as the ground the whole design stands on.

I expected nothing to come of it. Three weeks later I had a working compiler.

## The future showed up early

That speed is not normal. I've built toy compilers the slow way, and this was
not that.

The loop was intoxicating. We'd argue about the spec — should assignment copy or
alias, how should effects thread through a signature — and then working code
would appear, and more of it the next morning, and more the morning after. Much
of it was bad. It didn't matter. Something I'd have given a year to
alone was taking shape over a few weeks of subway rides and stolen minutes. I
remember the thought landing flat and certain: the future showed up early.

## It worked, and it was awful

This was the Opus 4.6 era, and some of the code was the worst I have ever
merged. Not because the model was dim — in a design argument it plainly knew
more about compilers than I do. But ask it to _implement_, and you got things
like this: I said "add a `len` method to arrays," and it hardcoded the string
`"len"` into the code generator. The test passed. It also generalized to exactly
nothing — the moment you wanted `capacity`, the trick fell apart. Reams of code
that were green and hopeless at once.

I kept going. Watching a language processor come to life day over day was fun
enough that the mess felt like a tax worth paying — and, though I didn't know it
yet, most of the next six months would go to paying it down.

## Nine parts refactoring

By January 30 — week four — `codegen.rs` had swollen to 15,579 lines. Everything
lived in it. Every change got slower than the last. This is where a solo hobby
project usually dies; instead it became the rhythm of the whole project: grow,
choke, re-architect. Again and again.

The IR story tells it best. First came **TIR**, a typed IR between the AST and
codegen — that one was easy, in by week two. Then **WIR**, a Wasm-level IR to
get codegen out of the raw-encoder business. The first attempt merged on
February 13 and was reverted on February 14 — a day. We wrote a design doc,
switched to a strangler-fig migration (wrap the old path, replace it from
inside), and landed it for real. Months later came **NIR**: born as a literal
copy of TIR, then made different by subtraction, deleting every node the
optimizer didn't need.

Then NIR's turning point, and the hardest thing in the whole project: rebuilding
the optimizer around a **value graph** with a worklist rewrite engine. One
session, about a week, 107 commits. For most of it I had no idea whether it
would pay off, so we pushed until the shape was undeniable and only then merged.
Harder than WIR. Worth it — the optimizer stopped being a pile of passes and
became a thing you could reason about.

Today `codegen.rs` is a thin orchestrator with no complex logic left in it. The
god file came apart by responsibility — typing into TIR, optimization into NIR,
Wasm assembly into WIR — each piece separable, testable, and small enough to
hold in your head. Across ~10,900 commits, only about one in seven adds a
feature — the rest is refactoring, fixing, optimizing, documenting. People ask
what steering agents feels like; it feels like that ratio.

## Make the artifact visible, then argue with it

None of the above works if you can't _see_ what the agent produced. The single
best investment in the whole project was making compiler output inspectable and
diffable, early.

`wado dump` — print the AST, TIR, NIR, or WIR of any program — landed on day 8.
On day 11 we started committing **golden files**: the WIR of every test fixture,
unparsed into readable text, checked into git. There are 1,332 of them now.
Change the compiler and the diff shows you exactly what the generated code did
in response. That diff is where the agent and I actually talk. rustc has tools
like this; every compiler does. The difference is that here they're
load-bearing: they turn "the agent claims" into "we both looked."

`wado test` got the same treatment, tuned for a reader that can't watch a
scrollbar. It prints a one-line digest every five seconds — `45/57 files ·
1077 tests, 0 failed · ETA ~9s` — so tailing two lines tells you everything.
And it accounts compile, load, and test as separate phases, so a failure
localizes itself: did the build break, or did the behavior? (From its own
output: the stdlib's 1,559 assertions run in 5 CPU-seconds; compiling the 57
files takes 62. The inner loop is the compiler.)

Around all this grew a set of **skills** — thirteen standing documents the
agents load per task: how to debug the optimizer, how to profile guest Wasm,
what "done" means before a PR. Written with the agents, for the agents, out of
whatever we got burned by that week.

And the models themselves, subjectively: 4.7 felt like 4.6. Opus 4.8 is visibly
smarter — and writes comments like it's paid by the word. The project rule
literally says "Comments: don't write them"; there are 181 commits trimming
comments anyway. Fable 5, pointed at the codebase and told to find code smells,
finds them in heaps. Different models, different jobs.

## Phones, containers, and nowhere to put packages

Almost all of this happens in Claude Code on the web, from a phone. Full months
run between 190 and 279 merged PRs. That's the good news.

The bad news is that cloud sessions are ephemeral in ways that bite. Containers
restart at random: a forty-minute test run evaporates, uncommitted diffs go with
it. You learn to commit early and often the way sailors learn about weather.

The worse news is distribution. In these sandboxed environments, GitHub
Releases are effectively unreachable — installing tools from them just doesn't
work. I don't blame anyone; GitHub is a business, and the era of using it as
everyone's free CDN was always going to end. But for a newborn language, it's a
real problem: where do packages live? Wado's original design used git repos as
the primary library registry — and that exact design can't resolve dependencies
from inside a web session. The workaround that works is OCI: publish libraries
as Wasm Component Model binaries to a container registry, fetch them from
anywhere. This blog is built by a Wado program that consumes its Markdown
renderer that way. The catch: a component boundary only speaks Component Model
types, which is fine for `render(string) -> html` and awkward for anything
richer. Distribution for new languages in the agentic era is an unsolved
problem, and I feel it weekly.

## Gale, or the untrodden path twice over

**Gale** is an ANTLR4-compatible parser generator written in Wado — feed it a
`.g4` grammar, get a parser and a syntax highlighter. At 48,000 lines of source
it is by far the largest Wado program in existence, roughly ten times the next
one. And it is fast. On the same SQLite grammar and input, benchmarked
side by side:

- Parsing: Gale **2.4 ms** vs ANTLR4's own Java parser at **213 ms** — about
  **88×** — and within 1.5× of hand-written `sqlparser-rs`.
- Highlighting: faster than tree-sitter (native _and_ Wasm), faster than Lezer,
  faster than Shiki. The only thing ahead is Prism, which doesn't parse — it's
  regex. Among highlighters that build a real syntax tree, Gale currently sits
  first.
- Generating: about **4×** faster than ANTLR4 at producing a parser from the
  same grammar.

The asterisk: Gale still diverges from ANTLR4 on real grammars — the SQLite
test suite pins several known differences, and there are surely more. It is not
yet a complete comparison. It is a real one, though — and 88× is not the kind
of gap a few bugs explain away.

Gale even accepts a few grammars ANTLR4 rejects — only where the meaning is
uniquely determined, never by guessing. A parser generator with opinions.

Step back. A 48K-line piece of systems software, in a language that did not
exist a year ago, written entirely by agents that had never seen it — while
fighting WasmGC performance cliffs down to a flat CST that took the highlighter
past tree-sitter. If someone had described this to me in 2024 I would have
smiled politely.

## The hobby that came back

I still haven't written a line of the compiler. At this point I don't think I
ever will, and I've stopped finding that strange. My job turned out to be
taste: which design survives the argument, which 15,000-line success is
actually a failure, when to stop a week-long rewrite and when to let it run.

The hobby I thought I'd lost to fatherhood came back in a form I didn't expect
— conversations in stolen minutes that compile. Wado is young, Gale has bugs,
the package story is unsolved. But the path is open, and barely walked. That's
the fun part.

Code: [wado-lang/wado](https://github.com/wado-lang/wado). Docs and this blog
are built with Wado itself.
