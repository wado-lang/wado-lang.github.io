---json
{
    "title": "Running in Lockstep: Wado, WASI 0.3, and the Road to Component Model 1.0",
    "date": "2026-07-12",
    "author": "FUJI Goro",
    "description": "WASI 0.3 just shipped and the road to Component Model 1.0 is drawn. For a language built for exactly this platform, here's what changed — and how Wado's syntax is WIT's vocabulary, checked by running a real handler.",
    "tags": [],
    "index": true
}
---

Two things just landed in the WebAssembly world, weeks apart. On June 11, 2026,
[WASI 0.3 was ratified](https://bytecodealliance.org/articles/WASI-0.3) — the
release that finally makes async native to Components. And the Bytecode Alliance
published [The Road to Component Model
1.0](https://bytecodealliance.org/articles/the-road-to-component-model-1-0), a
map of what's left before the whole foundation reaches a stable 1.0.

For most languages this is interesting infrastructure news. For Wado it's the
ground moving under our feet — on purpose. Wado is built for exactly one
platform: the Component Model and WASI. So this post is two things at once: a
tour of what actually changed, and a status report on a language designed to run
in lockstep with it.

## What WASI 0.3 actually changed

The headline is async, but the interesting part is *where* async lives now.

Under WASI 0.2, every component ran its own event loop. That sounds fine until
you try to compose two of them: two loops, no shared notion of "waiting," no way
to hand a stream from one to the other. WASI 0.3 rebases everything onto the
Component Model's async primitives, and — in the BCA's words — "the host is now
the one in charge of managing the one event loop that is shared by all
components." Composition becomes possible because there's one loop to compose
*around*.

Three new constructs enter the Canonical ABI:

- `stream<T>` — an owned handle for streaming data
- `future<T>` — an owned handle for a single async result
- `async func` — functions you can import and export directly

The model is *completion-based, not readiness-based* — the same shape as Linux's
`io_uring` or Windows IOCP. And the migration is "largely mechanical": WASI 0.2's
three-step "start-foo / finish-foo / subscribe" dance collapses into a single
`async func`, and `input-stream` / `output-stream` resources become plain
`stream<u8>`.

`wasi:http` shows the shift directly: the old `proxy` world is gone, replaced by
two explicit worlds — `service` (import a client, export a handler) and
`middleware` (a service that also imports a handler, so requests can flow through
a chain).

This isn't a preview. Wasmtime 46 ships WASI 0.3.0 with Component Model async on
by default; `jco` runs it in JavaScript today; guest toolchains for Rust, Go,
Python, and C are in progress.

## The road to 1.0 — and an honest note

The companion article is blunt in the best way: "We can start using this stuff
now." The Component Model is already in production. But a formal 1.0 still needs
work across five fronts — ABI, browser support, implementation simplification,
ecosystem, and WIT expressivity.

Two of those matter here. First, the **ABI**. In [our first post](/blog/hello.html)
I said WASI 0.3's async ABI felt heavy — a whiff of second-system syndrome. It
turns out the platform agrees: today's calling convention leans on
`cabi_realloc`, which fragments the heap, and 1.0 replaces it with a *lazy ABI*
built on opaque handles — no eager allocation, zero-copy forwarding between
components. Crucially, it ships as an optional feature in a 0.3.x release and
becomes the default at 1.0, and the transition is designed to be non-breaking. A
language that tracks the spec gets leaner boundaries later without changing a
line of source.

Second, the framing: **Component Model 1.0 and WASI 1.0 are distinct
milestones.** The article reaches for a microkernel analogy — the Component Model
is the computational substrate; WASI is the system layer (networking, storage,
clocks) built on top. WASI 1.0 waits on CM 1.0. So there isn't one finish line to
sprint to; there are two, stacked.

## So what does a language built for this look like?

Here's a complete `wasi:http/service` handler in Wado:

```wado
use { Request, Response, ErrorCode, Fields, Trailers } from "wasi:http";

export async fn handle(request: Request) -> Result<Response, ErrorCode> {
    let [body_rx, body_tx] = Stream::<u8>::new();
    let [trailers_rx, trailers_tx] = Future::<Result<Option<Trailers>, ErrorCode>>::new();

    let headers = Fields::new();
    let [response, _body] = Response::new(headers, Option::Some(body_rx), trailers_rx);
    response.set_status_code(200);

    task return Result::Ok(response);

    body_tx.write("Hello from Wado!\n".bytes().collect());
    body_tx.drop();

    trailers_tx.write(Result::Ok(null));
}
```

That's the whole program. `wado serve` compiles it to a `wasi:http/service`
component and runs it on Wasmtime:

```
$ wado serve handler.wado
HTTP server listening on http://127.0.0.1:8080/

$ curl -i http://127.0.0.1:8080/
HTTP/1.1 200 OK
transfer-encoding: chunked

Hello from Wado!
```

Everything WASI 0.3 shipped is just *there*, with no library glue: `async fn` is
the Component Model's async calling convention; `Stream<u8>` and `Future<…>` are
0.3's `stream<T>` and `future<T>`; `task return` hands the response back across
the canonical ABI without ending the function, so the handler keeps streaming the
body and writing trailers afterward — exactly the shape the shared event loop
wants. Note the light touch on types, too: the two fresh handles spell out their
`Stream::<u8>` and `Future::<…>`, but everywhere the surrounding types already
pin the answer — `Option::Some`, `Result::Ok`, `task return` — no turbofish
needed.

What does `handle` have to conform to? This, from Wado's standard library:

```wado
#[cm("wasi:http/handler@0.3.0")]
pub interface Handler {
    #[cm("wasi:http/handler@0.3.0#handle")]
    async fn handle(request: Request) -> AsyncCall<Result<Response, ErrorCode>>;
}
```

That file isn't handwritten — its header reads `#![generated(by =
"wado-from-idl", sources = [".../http.wit"])]`. It's generated straight from
wasmtime's WASI 0.3 WIT, and the `#[cm(...)]` attributes pin the exact Component
Model identity; the only thing that changes across the boundary is cosmetic,
`kebab-case` to `PascalCase`.

And here's what ties the language together. When a handler needs a capability —
say an outbound HTTP `Client` to call another service — it names it with a `with`
clause: `... -> Result<Response, ErrorCode> with Client`. `Client` is a WASI
interface. But `with` isn't HTTP plumbing; it's Wado's **effect system**. The
same `interface` construct is a WASI interface, a Component Model import/export,
*and* a user-defined effect — one of our examples literally declares `interface
Log { ... }` and calls it "the subscriber, as an effect." So when the first post
said effects are how the WASI surface shows up in the type system, that wasn't a
metaphor.

It runs both directions, too. Wado doesn't only *consume* WIT; the compiler
synthesizes WIT from your declarations and bundles it into the component, so a
consumer in any other CM language can generate bindings against a Wado component.
And when both ends are Wado, it can skip the canonical ABI entirely and share
Wasm GC types directly — which is where the tiny-binary story from last time
meets the platform's own roadmap, since GC across component boundaries is one of
the things still being finished.

## Try it yourself

The handler above is real. Grab a release binary — the archive name is derived
from `uname`, so this works as-is on Linux (`x86_64`, `aarch64`) and macOS
(Apple Silicon) — and verify it against the published checksums:

```sh
BASE=https://github.com/wado-lang/wado/releases/latest/download
ASSET="wado-$(uname -s | tr A-Z a-z)-$(uname -m).tar.gz"

curl -fsSLO "$BASE/$ASSET"

# Verify against the checksums published with the release
if command -v shasum >/dev/null; then
  curl -fsSL "$BASE/SHA256SUMS.txt" | shasum -a 256 --ignore-missing -c -
else
  curl -fsSL "$BASE/SHA256SUMS.txt" | sha256sum --ignore-missing -c -
fi

tar xzf "$ASSET"
```

Then drop the handler into `handler.wado`, run `wado serve handler.wado`, and
`curl` it. (Prefer building from source? With a Rust toolchain, `cargo install
--git https://github.com/wado-lang/wado wado-cli`.)

## The vocabulary is the same

The reason all of this fits so cleanly is that Wado didn't invent a type system
and then map it onto WIT. Its surface constructs *are* WIT's type kinds:

| WIT | Wado | Example |
| --- | --- | --- |
| `interface` | `interface` | `interface handler` → `interface Handler` |
| `record` | `struct` | `record instant` → `struct Instant` |
| `variant` | `variant` | `variant error-code` → `variant ErrorCode` |
| `enum` | `enum` | `enum advice` → `enum Advice` |
| `flags` | `flags` | `flags open-flags` → `flags OpenFlags` |
| `resource` | `resource` | `resource request` → `resource Request` |
| `world` | `world` | `world service` → `world Service` |
| `func` | `fn` | `now: func() -> mark` → `fn now() -> Mark` |
| `async func` | `async fn … -> AsyncCall<T>` | `handle: async func(...)` → `async fn handle(...) -> AsyncCall<…>` |
| `stream<T>` / `future<T>` | `Stream<T>` / `Future<T>` | `option<stream<u8>>` → `Option<Stream<u8>>` |
| `tuple<a, b>` | `[a, b]` | `tuple<request, future<…>>` → `[Request, Future<…>]` |
| `option` / `result` / `list` | `Option` / `Result` / `List` | `list<u8>` → `List<u8>` |

The entire `wasi:*` standard library is generated from WIT this way. Reading it
feels less like a binding layer and more like the same document in a different
font.

## Running in lockstep

Wado is not 1.0. It's experimental, and it's waiting on precisely the things the
platform is still finishing: the Component Model in browsers, GC across component
boundaries, the lazy ABI. That's not a coincidence or a roadmap we borrowed —
it's what it means to build a language *for* a platform instead of porting one
*to* it. Wado's timeline is the platform's timeline.

WASI 0.3 shipped. The road to Component Model 1.0 is drawn. When these land,
Wado's era begins — and it'll already be speaking the language.
