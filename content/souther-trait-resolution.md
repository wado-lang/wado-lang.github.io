---json
{
    "title": "Checking Wado's Trait Resolution Against a Souther Model",
    "date": "2026-11-16",
    "author": "FUJI Goro",
    "description": "Two compiler bugs, found by checking Wado's trait resolution against an executable model of its spec on 888 generated programs.",
    "tags": [],
    "index": true
}
---

Which impl runs when you call `x.m()`? Wado's specification answers in four
short rules. Those rules fit in a small program, and that program can check the
compiler. Run against 888 generated cases, it found two compiler bugs on the
first try. This post shows how that works, step by step.

## The problem: which impl runs?

In Wado, as in Rust, a type gets methods from _impls_. One method call can have
several impls to choose from:

```wado
trait Alpha with () {
    fn m(&self) -> String;
}

struct Pair<A, B> { a: A, b: B }
type N = Pair<i32, i32>;             // a newtype: a distinct type over Pair<i32, i32>

impl<X> Alpha for Pair<X, i32> { … }  // a "head" impl: any Pair whose second argument is i32
impl Alpha for N { … }                 // an "exact" impl: written for N itself

let x: N = { a: 1, b: 2 };
x.m();                                 // which one runs?
```

Choosing is _trait resolution_. The specification
([`spec-traits.md`](https://wado-lang.org/docs/spec-traits.html)) states the
rules as an order:

1. An inherent method (`impl N { fn m … }`) wins over every trait method.
2. The newtype before its base: an impl for `N` wins over one for
   `Pair<i32, i32>`.
3. The more specific impl wins: one for the exact type, then one for its head,
   then a _blanket_ impl (`impl<T: Bound> Alpha for T`), which applies to any
   type meeting a bound.
4. Whatever is still tied is an error, and the error says how to fix it.

In the example above, the impl for `N` runs, by rule 2.

Each rule is simple. The trouble is how many ways they combine. Which impls
exist, at which level, whether a blanket's bound holds, which traits are
imported: every combination has one right answer. And there are several ways to
write a call: `x.m()`, `N::m(&x)`, `Alpha::m(&x)`, or a call inside a generic
function. The last two name the trait, so they never pick an inherent method or
another trait's impl. Beyond that, every form should give the same answer.

Trait resolution has a long history of bugs in Wado. The tests in the repository
are programs someone wrote by hand. They check the combinations someone thought
of.

## The idea: write the rules as a program

Instead of testing cases one at a time, the approach here has three steps:

1. Write the rules as a small program, separate from the compiler. Call it the
   _model_. It takes a description of a situation (which impls exist, how the
   call is written) and answers which impl should run.
2. Generate every situation within some bounds.
3. For each one, write the real Wado program, compile and run it, and compare
   what the compiler did with what the model says.

When the two disagree, something is wrong: the compiler, the rules, or the
comparison itself. Reading the disagreement says which, and each
is worth knowing.

The model needs to be easy to read and check against the spec. It is written in
[Souther](https://github.com/souther-lang/souther), a language for writing down
rules. It has two properties that matter here. Its examples are checked when
the model compiles, and it can compile the model to a WebAssembly component,
which Wado can call. The second one is what makes step 3 possible, as shown
below.

## The model

The model covers one receiver, `N` from above, and two traits, `Alpha` and
`Beta`, which both declare `m(&self)`. Each candidate impl is described by four
facts: its trait, what it targets, the level it sits at, and whether its bound
holds:

```text
data TraitName = Alpha | Beta
data Target = Exact | Head | Blanket
data Level = AtNewtype | AtBase

data Candidate = { name: String, trait: TraitName, target: Target, level: Level, boundHolds: Bool }
```

Each rule of the spec becomes a function. Rule 2, the newtype before its base,
keeps only the newtype's candidates when there are any:

```text
let firstLevel (cs: List<Candidate>): List<Candidate> =
    if List.any(c -> c.level == AtNewtype, cs) then List.filter(c -> c.level == AtNewtype, cs) else cs
```

After rule 3 keeps the most specific candidates, exactly one is left, or none,
or a tie. A tie is one of the errors the spec names:

```text
let answer (top: List<Candidate>, applying: List<Candidate>): Selected | AmbiguousTraits | AmbiguousBlankets | AmbiguousHeads | DuplicateImpl | NotImported | NoMethod =
    match List.get(0, top) with
        | None -> if List.isEmpty(applying) then NoMethod else NotImported
        | Some first ->
            if List.length(top) == 1 then Selected { name = first.name }
            else if List.any(c -> c.trait /= first.trait, top) then AmbiguousTraits
            else {
                match first.target with
                    | Blanket -> AmbiguousBlankets
                    | Head -> AmbiguousHeads
                    | Exact -> DuplicateImpl
            }
```

The model has to agree with the spec before it is any use. So the spec's own
examples are written as rows, and the Souther compiler refuses to build the
model if a row does not hold:

```text
example resolve
    | "the newtype before its base"
        : (Call { candidates = [ Candidate { name = "a", trait = Alpha, target = Blanket, level = AtNewtype, boundHolds = true }
                               , Candidate { name = "b", trait = Alpha, target = Exact, level = AtBase, boundHolds = true } ]
                , inherent = NoInherent, scope = BothImported, form = MethodCall })
        -> Selected { name = "a" }
```

This row says: a blanket impl at the newtype's level beats an exact impl at the
base's level, because rule 2 comes before rule 3.

## Asking the model from Wado

The comparison runs in a Wado program, the _driver_. For every situation it
generates, the driver has to ask the model what should happen. This is where
the Wasm component comes in.

Souther compiles the model to a component of the WebAssembly Component Model.
A component describes its interface in WIT, a language for typed interfaces
between Wasm programs. The model's data types become WIT types:

```wit
enum target { exact, head, blanket }
enum level { at-newtype, at-base }
record candidate { name: string, trait: trait-name, target: target, level: level, bound-holds: bool }
variant resolve-result { ambiguous-blankets, ambiguous-heads, ambiguous-traits, duplicate-impl, no-method, not-imported, selected(selected) }

resolve: func(call: call) -> result<resolve-result, refusal>;
```

Wado can import a component directly, and its WIT types arrive as Wado types.
No binding generator or glue code sits in between:

```wado
use { "souther:typed-program/resolution" as Model, "souther:typed-types/resolution" as T }
    from "./resolution.wasm" with { type: "wasm" };
```

So the driver writes a situation as an ordinary Wado value, and reads the
model's answer with an ordinary `match`:

```wado
let candidate: T::Candidate = { name: "c1", trait: Alpha, target: Exact, level: AtBase, bound_holds: true };

fn expected(call: T::Call) -> String {
    return match Model::resolve(call) {
        Ok(Selected(s)) => s.name,
        Ok(AmbiguousTraits) => "error: ambiguous traits",
        Ok(AmbiguousBlankets) => "error: ambiguous blankets",
        Ok(AmbiguousHeads) => "error: ambiguous heads",
        Ok(DuplicateImpl) => "error: duplicate impl",
        Ok(NotImported) => "error: not imported",
        Ok(NoMethod) => "error: no method",
        Err(_) => panic("the model refused a call"),
    };
}
```

This setup has three practical benefits.

### Asking is cheap

The model runs inside the driver's own process. A question is a function call.
Nothing starts a separate program per question, so the driver can ask once for
every generated case.

### Nothing is converted by hand

The driver does not turn a situation into JSON for the model, and does not parse
the answer back. The types are checked on both sides. If the model gains a new
kind of answer, the `match` above stops compiling until the driver handles it.

### One value drives both sides

The driver builds the Wado source of the impls from the same `T::Candidate` list
it sends to the model. The program that runs and the situation the model judges
cannot drift apart.

## Generating the cases

The driver tries every combination within these bounds:

- zero, one or two candidate impls, each one of twelve shapes, six per trait:
  an exact impl for `N` or for `Pair<i32, i32>`, a head impl for `Pair`, a
  blanket whose bound holds at `N` or at `Pair<i32, i32>`, or a blanket whose
  bound fails. A pair never holds two exact impls of one trait at one level,
  since the compiler rejects that where it is written.
- an inherent method on the newtype, on the base, or none, tried beside one
  candidate only
- both traits imported, or only `Alpha`
- four ways to write the call: `x.m()`, `N::m(&x)`, `Alpha::m(&x)`, and
  `go(&x)` where `fn go<T: Alpha>(t: &T)` calls `t.m()`

For each combination it writes a small program in two files, a library holding
the traits and impls and a main module that imports some of them and makes the
call. Then it runs `wado run` on the program through `core:process` and reads
what the program printed or what error the compiler reported.

## What it found

| Programs | Agreed with the model | Disagreed |
| -------- | --------------------- | --------- |
| 888      | 775                   | 113       |

The disagreements have three causes.

### Two compiler bugs

A method call on a newtype misses an impl written for one instantiation of its
base, and the error message contradicts the code:

```wado
struct Pair<A, B> { a: A, b: B }
type N = Pair<i32, i32>;
impl Alpha for Pair<i32, i32> { fn m(&self) -> i32 { return 1; } }

test {
    let x: N = { a: 1, b: 2 };
    assert x.m() == 1;   // error: type `Pair<i32, i32>` does not implement trait `Alpha`
}
```

A head impl (`impl<X> Alpha for Pair<X, i32>`) works, and so does a base that
is not generic.

The second bug is close by. When a program calls that same impl on a
`Pair<i32, i32>` value and on an `N` value, the compiler generates the impl
twice under two names and crashes.

Both are filed as
[#2643](https://github.com/wado-lang/wado/issues/2643) and
[#2644](https://github.com/wado-lang/wado/issues/2644). These two explain every
disagreement in `x.m()` and `Alpha::m(&x)`.

### `N::m(&x)` follows different rules

The design document for trait resolution already notes this as a known gap:
the ways of writing a call do not share one implementation yet. The run turned
that note into concrete cases. `N::m(&x)` does not see blanket impls, ignores
rule 2, blames a trait that is not imported even when an imported one answers,
and treats an inherent method on the base differently from `x.m()`.

### One unclear rule in the spec

The spec lists "two traits declaring the method name" as one kind of tie that
rule 4 reports. Its reason is that two traits share no contract, so the call
must name one. Read by that reason, every such call is an error. Read by its
place under rule 4, the ranks come first, so an exact impl of `Alpha` beats a
head impl of `Beta`. The compiler takes the second reading. The model had to
pick one. It follows the compiler for now, and the spec's wording is an open
question.

## A smaller rule first

Before trait resolution, the same method went over a smaller rule: when a call
marked `unchecked` still has its contract checked. The answer depends on the
command (`wado run`, `wado test`, …), the optimization level, and the `-f`
flags. Where the spec gives no answer, that model answers `SpecSilent` instead
of guessing.

| Runs | Agreed with the model | Disagreed | The spec gives no answer |
| ---- | --------------------- | --------- | ------------------------ |
| 120  | 96                    | 0         | 24                       |

Every case without an answer comes from one question: what happens when both
`-f contract-checks` and `-f no-contract-checks` are given. The compiler always
lets the later flag win, but the spec does not say so.

That rule was already written precisely, so there was little to find. The
method pays off on rules with many conditions, like trait resolution.

## Next

Fix the two bugs, then extend the model to references, variadic impls and
imports across modules, and run it again.
