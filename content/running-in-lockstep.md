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

Two things landed in the WebAssembly world weeks apart. On June 11, 2026,
[WASI 0.3 was ratified](https://bytecodealliance.org/articles/WASI-0.3) — the
release that makes async native to Components. And the Bytecode Alliance
published [The Road to Component Model
1.0](https://bytecodealliance.org/articles/the-road-to-component-model-1-0),
mapping what's left before the foundation reaches a stable 1.0.

For most languages this is infrastructure news. For Wado it's the ground moving
under our feet — on purpose. Wado is built for exactly one platform: the
Component Model and WASI. So this post is both a tour of what changed and a
status report on a language designed to run in lockstep with it.

## What WASI 0.3 actually changed

The headline is async, but the interesting part is *where* async lives now.

Under WASI 0.2, every component ran its own event loop. Fine — until you compose
two of them: two loops, no shared notion of "waiting," no way to hand a stream
from one to the other. WASI 0.3 rebases everything onto the Component Model's
async primitives so that, in the BCA's words, "the host is now the one in charge
of managing the one event loop that is shared by all components." Composition
works because there's one loop to compose *around*.

Three new constructs enter the Canonical ABI:

- `stream<T>` — an owned handle for streaming data
- `future<T>` — an owned handle for a single async result
- `async func` — functions you can import and export directly

The model is *completion-based, not readiness-based* — the same shape as Linux's
`io_uring` or Windows IOCP. The migration is "largely mechanical": WASI 0.2's
three-step "start-foo / finish-foo / subscribe" dance collapses into a single
`async func`, and `input-stream` / `output-stream` become plain `stream<u8>`.

`wasi:http` shows the shift directly: the old `proxy` world is gone, replaced by
two explicit worlds — `service` (import a client, export a handler) and
`middleware` (a service that also imports a handler, so requests flow through a
chain).

This isn't a preview. Wasmtime 46 ships WASI 0.3.0 with Component Model async on
by default; `jco` runs it in JavaScript today; guest toolchains for Rust, Go,
Python, and C are in progress.

## The road to 1.0 — and what it doesn't fix

The companion article is blunt in the best way: "We can start using this stuff
now." The Component Model is already in production — but a formal 1.0 still needs
work across five fronts: ABI, browser support, implementation simplification,
ecosystem, and WIT expressivity.

The ABI is where I keep the reservations from [the first
post](/blog/hello.html). Today's calling convention runs on `cabi_realloc`, and
the trouble isn't only heap fragmentation — it's the churn. Values crossing a
component boundary drive a relentless stream of small allocations and frees, and
the overhead is real. Worse, it forces every guest to bring a serious allocator
of its own. Being a Wasm-GC language buys Wado nothing here: the host's collector
manages GC objects, but the canonical ABI lives in linear memory, so we still had
to write a full free-list allocator — bins, coalescing, splitting, the works — in
[`allocator.wado`](https://github.com/wado-lang/wado/blob/main/wado-compiler/lib/core/allocator.wado).
A garbage-collected language shipping its own `malloc`, whose throughput then
rate-limits the boundary, is exactly the kind of thing that makes me mutter
"second-system syndrome."

I had hoped Component Model 1.0 would dissolve this by integrating the Component
Model with Wasm GC — letting GC objects cross boundaries directly, so the
linear-memory allocator wouldn't be needed at all. It isn't on the list. That's
the omission I'm most disappointed by.

There is a new model in flight — the *lazy ABI*, built on opaque handles that
avoid eager allocation, non-breaking (optional in a 0.3.x release, default at
1.0). It could change this picture. But there's nothing to benchmark yet, so I'll
stay neutral: promising on paper, unproven in practice. And the async machinery
those handles serve is as intricate as ever — nothing on the 1.0 track makes it
*simpler*.

One more piece of framing worth keeping straight: **Component Model 1.0 and WASI
1.0 are distinct milestones** — the Component Model is the computational
substrate, WASI the system layer on top, and WASI 1.0 waits on CM 1.0. Two finish
lines, stacked.

My read hasn't moved since the first post: the Component Model and WASI are
wonderful — genuinely. But they aren't magic, and the second-system-syndrome
smell hasn't cleared.

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

Everything WASI 0.3 shipped is just *there*, no glue: `async fn` is the Component
Model's async calling convention; `Stream<u8>` and `Future<…>` are 0.3's
`stream<T>` and `future<T>`; `task return` hands the response back across the
canonical ABI without ending the function, so the handler keeps streaming the
body and writing trailers afterward. Note the light touch on types: the two fresh
handles spell out `Stream::<u8>` and `Future::<…>`, but where the surrounding
types already pin it — `Option::Some`, `Result::Ok`, `task return` — no turbofish
is needed.

What does `handle` conform to? This, from Wado's standard library:

```wado
#[cm("wasi:http/handler@0.3.0")]
pub interface Handler {
    #[cm("wasi:http/handler@0.3.0#handle")]
    async fn handle(request: Request) -> AsyncCall<Result<Response, ErrorCode>>;
}
```

That file isn't handwritten — its header reads `#![generated(by =
"wado-from-idl", sources = [".../http.wit"])]`. It's generated straight from
wasmtime's WASI 0.3 WIT; the `#[cm(...)]` attributes pin the exact Component Model
identity, and the only thing that changes across the boundary is cosmetic —
`kebab-case` to `PascalCase`.

And here's what ties it together. When a handler needs a capability — an outbound
HTTP `Client`, say — it names it with a `with` clause: `... -> Result<Response,
ErrorCode> with Client`. `Client` is a WASI interface. But `with` isn't HTTP
plumbing; it's Wado's **effect system**. The same `interface` construct is a WASI
interface, a Component Model import/export, *and* a user-defined effect — one of
our examples declares `interface Log { ... }` and calls it "the subscriber, as an
effect." So when the first post said effects are how the WASI surface shows up in
the type system, that wasn't a metaphor.

It runs both directions. Wado doesn't only *consume* WIT — the compiler
synthesizes WIT from your declarations and bundles it into the component, so any
other CM language can bind against a Wado component. And when both ends are Wado,
it skips the canonical ABI and shares Wasm GC types directly — where last time's
tiny-binary story meets the roadmap, since GC across component boundaries is one
of the things still being finished.

## Try it yourself

The handler above is real. Grab a release binary — the archive name comes from
`uname`, so this works as-is on Linux (`x86_64`, `aarch64`) and macOS (Apple
Silicon) — and verify it against the published checksums:

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

All of this fits because Wado didn't invent a type system and then map it onto
WIT. Its surface constructs *are* WIT's type kinds:

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

Wado is not 1.0 either. It's experimental, waiting on precisely the things the
platform is still finishing: the Component Model in browsers, GC across component
boundaries, the lazy ABI. That's not a borrowed roadmap — it's what building a
language *for* a platform, instead of porting one *to* it, means. Wado's timeline
is the platform's timeline.

WASI 0.3 shipped. The road to Component Model 1.0 is drawn. When these land,
Wado's era begins — and it'll already be speaking the language.
