---json
{
    "title": "Hello, Wado!",
    "date": "2026-07-11",
    "tags": [],
    "index": true
}
---

Welcome to the Wado blog. Wado is a statically-typed, garbage-collected
language with the comforts you'd expect — generics, traits, exhaustive
pattern matching. But it is built for exactly one target: WebAssembly, and
specifically the Component Model and WASI 0.3. That single constraint shapes
everything about the language, and it's what this first post is really about.

Let's start with the traditional greeting:

```wado
use { println, Stdout } from "core:cli";

export fn run() with Stdout {
    println("Hello, world!");
}
```

Nothing surprising — until you look at the signature. `export fn run()`,
fine. But `with Stdout`? Printing a line has to be *declared in the type*?
Hold that thought; we'll come back to it.

## Built for the Component Model and WASI 0.3

Everyone knows WebAssembly: a fast, sandboxed compilation target. But core
Wasm is deliberately spartan. It has numbers, linear memory, and functions —
and that's all. No strings, no records, no lists. Two modules written in two
different languages have no standard way to hand each other a string, let
alone a list of structs. For years we all papered over this with ad-hoc
conventions layered onto raw memory.

The Component Model (CM) fixes that. It adds a language-neutral type system on
top of Wasm — `string`, `list`, `record`, `variant`, `enum`, `flags`,
`resource` — so components compose across language boundaries through real,
typed interfaces.

The clearest way to picture it is *nanoservices*. Microservices gave you
language-independent units talking over a standardized protocol. The Component
Model gives you the same idea, except the boundary is a Wasm call instead of a
network hop, and the grain is far finer. A component is a sealed unit behind a
typed interface, and you wire components together the same way whether you're
in a browser or on a server.

WASI 0.3 is the standard library written in that vocabulary — filesystems,
sockets, HTTP, clocks — every one of them defined as a Component Model
interface. Its headline feature is first-class async, built on futures and
streams.

It's a genuinely exciting stack. It is not, however, magic.

*The ABI has a cost.* It's far cheaper than serializing to JSON, but crossing
a component boundary still means marshalling values in and out. Carve a
trivial piece of logic into its own component and the boundary can easily cost
more than the logic itself — the same trap core Wasm always had, just one
level up. Composition is a tool, not a free lunch.

*It isn't in browsers yet.* The Component Model is still a draft, so that's
fair enough — but "runs everywhere" comes with an asterisk today.

*WASI 0.3's async ABI is complicated.* The design is powerful, but the
machinery is heavy and the overhead is proportional to that complexity.
There's a faint whiff of second-system syndrome about it.

So: a wonderful foundation, with real and non-trivial drawbacks. Wado bet on
it anyway — with eyes open. The wager is that if you design a language to *fit
this shape* from the start, instead of bolting Wasm on as one backend among
many and generating glue to reach the Component Model, you get onto this
future far more directly. Wado's type system *is* the Component Model's type
system: the split into `variant` (sum types with payloads), `enum` (bare
discriminants), and `flags` (bitsets) exists precisely because those are the
Component Model's type kinds. Wado didn't inherit that three-way split from
Rust — it grew it to match the platform.

## The reveal

Which brings us back to that `with Stdout`.

`Stdout` is not a Wado invention. It's `wasi:cli`'s standard-output interface,
straight from WASI. And here is the design decision that fuses the language to
the platform: **Wado models every WASI interface and resource as an effect.**
Printing touches the outside world, so it surfaces in the type — `with
Stdout` — exactly like any other effect. Effects aren't a
functional-programming flourish grafted onto the language; they *are* how the
WASI surface appears in Wado's type system. The platform's boundaries and the
language's effects are one and the same.

## No borrow checker, just GC

Wado is not Rust, even if it rhymes. No lifetimes, no borrow checker, no
ownership, no `unsafe`, no macros. Memory is handled by Wasm's garbage
collector. Values have value semantics: assigning or passing a value
deep-copies it, and only references (`&T`, `&mut T`) share. It's a calmer
model to write in — you reason about what your code *means*, not about who
owns what.

The obvious worry is performance. GC plus copy-on-assign sounds slow. In
practice, aggressive optimization claws most of it back: some Wado programs
run about as fast as Rust, some are meaningfully slower, but it's rarely the
disaster the description suggests. And the Wasm it emits is *small* — often
dramatically smaller than the equivalent Rust binary, which matters when your
modules are nanoservices you compose and ship. (There's a whole benchmark post
hiding in that sentence. Another day.)

## There's more

This is a tour, not a manual, so just briefly: Wado has effect *handlers* (you
can handle those effects, not merely declare them), power-assert-style
assertions that can never be disabled, exhaustive pattern matching via
`match`, `if let`, and a `matches` operator, and template strings with typed
formatting. The `docs/spec.md` in the main repo has the full story.

## This blog runs on Wado

One last thing. The blog you're reading is generated by Wado. The static site
generator behind it — *Sheaf* — is a Wado program, and this very page was
rendered by *Marl*, Wado's own Markdown processor. No server, no database:
Markdown files go in, HTML comes out, Wado all the way from front matter to
footer.

Bootstrapping a blog in your own language is a small thing. But it's the kind
of small thing that only works if the language actually does.

Hello, Wado. More soon.
