---json
{
    "title": "A Tour of Wado Through an HTTP Service",
    "date": "2026-07-13",
    "author": "FUJI Goro",
    "description": "Walking through example/http_bin.wado — a single-file httpbin clone on the Component Model's wasi:http/service world — to see what Wado actually feels like to write.",
    "tags": [],
    "index": true
}
---

Feature lists tell you what a language has; a real program tells you what it's
like to use. So let's read one.
[`example/http_bin.wado`](https://github.com/wado-lang/wado/blob/main/example/http_bin.wado)
is a single-file clone of httpbin — the echo service every HTTP developer has
curl'd at some point. It answers `/get`, `/headers`, `/status/:code`, and more
on the Component Model's `wasi:http/service` world, leaning on the standard
library the whole way.

Run it and hit an endpoint:

```
$ wado serve example/http_bin.wado
HTTP server listening on http://0.0.0.0:8080/

$ curl -i http://localhost:8080/get
HTTP/1.1 200 OK
server: http_bin.wado
content-type: application/json
trailer: server-timing
transfer-encoding: chunked

{
  "method": "GET",
  "path": "/get",
  "args": {},
  "headers": {
    "host": "localhost:8080",
    "user-agent": "curl/8.5.0",
    "accept": "*/*"
  },
  "origin": "",
  "url": "http://localhost:8080/get",
  "body": null
}
```

That `trailer: server-timing` is real — the handler sets it after the body, and
curl delivers it. And the same handler already speaks HTTP/2:
`curl --http2-prior-knowledge` gets an `HTTP/2 200`, because wasmtime terminates
the protocol and `wasi:http` is deliberately protocol-agnostic.

We'll walk through it, from the shape of the service down to the language
details.

## The shape of a service

### One-file scripts, with the standard library and WASI in scope

A Wado file can be made directly executable with a shebang — one-file scripts
are first-class:

```wado
#!/usr/bin/env wado serve
```

The standard library is namespaced (`core:*` for the language runtime,
`wasi:*` for WASI worlds) and imported the way ES modules are:

```wado
use { Request, Response, Method, Scheme, ErrorCode } from "wasi:http";
use { MonotonicClock } from "wasi:clocks";
use { TreeMap } from "core:collections";
use { decode } from "core:base64";
use { Serialize } from "core:serde";
use { Url } from "core:url";
use json from "core:json";
```

Notice that `wasi:http` and `wasi:clocks` are imported the same way as
`core:json` — WASI worlds are simply modules.

### Effects belong in the function type

```wado
export async fn handle(request: Request) -> Result<Response, ErrorCode>
    with MonotonicClock {
```

The `with` clause lists the capabilities this function uses. `MonotonicClock`
is a WASI capability, not a global; the runtime grants it on entry. Pure
functions have no `with` clause, and you can tell at a glance.

`async fn` declares a Component Model–level async function, which the host can
suspend and resume across the canonical ABI.

### `task return`: hand off the response, then keep working

```wado
task return Result::Ok(response);

body_tx.write(body_str.as_bytes());
body_tx.drop();
```

In a Component Model `async fn`, `task return` delivers the result to the caller
without ending the function. The handler can then continue streaming the body,
write trailers, and emit access logs — all after the response status is already
on the wire. That `server-timing` trailer from earlier is written right here.

## Handling a request

### `match` as an expression, even on strings

```wado
match path {
    "/"            => { content_type = "text/html; charset=utf-8"; body_str = HOMEPAGE; },
    "/get"         => { /* ... */ },
    "/post"        => { /* ... */ },
    "/headers"     => { /* ... */ },
    "/ip"          => { /* ... */ },
    "/user-agent"  => { /* ... */ },
    _              => { /* dynamic routes: /status/:code, /base64/:val, ... */ },
}
```

`match` is an expression and works on string literals as well as variants. The
wildcard arm dispatches the dynamic routes through a separate function.

### Tuples are first-class return values

```wado
fn echo_if_method(/* ... */) -> [StatusCode, String, Option<String>] {
    /* ... */
    return [200, build_request_json(/* ... */), null];
}

let [s, b, a] = echo_if_method(request, method, Method::Get, "GET", false, url, path, args);
```

Tuple literal syntax (`[a, b, c]`) is the same in types, expressions, and
patterns. There is no third syntax for "multiple return values" — there's just
tuples and destructuring.

### Auto-derived JSON, one line

```wado
struct RequestInfo {
    method: String,
    path: String,
    args: TreeMap<String, String>,
    headers: TreeMap<String, String>,
    origin: String,
    url: String,
    data: Option<String>,
}
impl Serialize for RequestInfo;
```

The single line `impl Serialize for RequestInfo;` derives the serializer. There
is no separate macro and no schema file — the struct's field types are the
schema.

### Declarative naming for the wire format

```wado
#[serde(rename_all = "kebab-case")]
struct UserAgentResponse {
    user_agent: Option<String>,
}
impl Serialize for UserAgentResponse;
```

The attribute renames `user_agent` to `user-agent` on the wire. Idiomatic Wado
naming on the inside, idiomatic JSON on the outside.

## The language up close

### Exhaustive pattern matching over variants

```wado
fn scheme_name(s: Option<Scheme>) -> String {
    return match s {
        Some(Http)        => "http",
        Some(Https)       => "https",
        Some(Other(name)) => name,
        None              => "http",
    };
}
```

`Scheme` is a variant — a sum type with payloads — imported straight from
`wasi:http`. The compiler verifies that every case is covered, including the
nested `Other(name)` payload that carries a custom scheme string.

### Template strings with format specifiers

```wado
trailers.append(
    "server-timing",
    `app;dur={elapsed_ms:0.3f}`.as_bytes() as FieldValue,
);
```

Backtick strings interpolate expressions like TypeScript, but the `:0.3f`
format specifier is checked at compile time against the value's `Display` impl.
The result is `app;dur=12.345`.

### `if let` with guards

```wado
if let Some(a) = request.get_authority() && !a.is_empty() {
    return a;
}
```

Pattern binding and a boolean guard combine in a single condition. The bound
name `a` is in scope for both the guard and the body.

### Compile-time file inclusion

```wado
global HOMEPAGE: String = #include_str("./http-bin-index.html");
```

The HTML for `/` lives in a separate file for editing comfort, but ends up baked
into the `.wasm` as a constant. There is no filesystem read at runtime, and no
separate asset to ship.

## Read the whole thing

None of these is a headline feature on its own. Together they're the texture of
the language: effects in the type, errors as values, one obvious syntax per
idea, and the Component Model showing through instead of being hidden. The full
source is
[`example/http_bin.wado`](https://github.com/wado-lang/wado/blob/main/example/http_bin.wado)
— a complete, working httpbin in a single file.
