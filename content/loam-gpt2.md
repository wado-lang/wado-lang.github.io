---json
{
    "title": "GPT-2 in a Browser Tab, Compiled Ahead of Time",
    "date": "2026-09-28",
    "author": "FUJI Goro",
    "description": "Loam turns an ONNX model into ordinary Wado source at build time, with tensor shapes checked like TypeScript types. GPT-2 now runs that way in the browser. An introduction for programmers who have never touched machine learning or Wado.",
    "tags": [],
    "index": false
}
---

Open [wado-lang.org/gpt2/](https://wado-lang.org/gpt2/) in Chrome, type
"Hello, my name is", and press Generate. GPT-2 continues the sentence one word
at a time. GPT-2 is the language model OpenAI released in 2019, and this is its
smallest version. No server runs the model. The page downloads its _weights_
(124 million numbers that training produced, 548 MB) straight from Hugging
Face, once, and every calculation happens inside your tab. The prompt never
leaves it.

What's new here is how the model got into the page. Nobody ported GPT-2 to Wado
by hand. **Loam**, a package written in Wado, read GPT-2's model file at build
time and wrote it out as ordinary Wado source code, which then compiled to
WebAssembly like any other program.

This post walks through what that means, from zero. It assumes no machine
learning and no Wado.

## Wado in one paragraph

Wado is a programming language that compiles to WebAssembly (Wasm), the binary
format browsers run alongside JavaScript. It reads a lot like Rust or
TypeScript: static types, generics, `fn`, `struct`. A Wado program becomes a
Wasm _component_, a Wasm module with a typed interface. The same component runs
from the command line or, once [jco](https://github.com/bytecodealliance/jco)
turns it into an ES module, in a browser. The GPT-2 page takes the second route.

## What a language model does

Strip away the hype and a language model is one function: given the text so
far, score every possible next piece of text.

The pieces are called _tokens_: whole words, parts of words, or punctuation.
GPT-2 knows 50,257 of them, and each has a number. Our prompt becomes five:

```text
"Hello, my name is"  →  [15496, 11, 616, 1438, 318]
                          Hello  ,  ␣my ␣name ␣is
```

The model takes those ids and returns 50,257 scores, one for every token it
knows. The page picks the highest, appends it, and asks again. That loop is the
whole of text generation. Here it is from the page's worker, trimmed:

```js
const ids = Array.from(api.encode(prompt));
for (let i = 0; i < steps; i++) {
  ids.push(api.nextToken(ids));
  post({ type: "text", text: api.decode(ids) });
}
```

Always taking the top score is called _greedy decoding_. It's the simplest
strategy there is, and it's deterministic: the same prompt gives the same
continuation every time.

## Tensors are arrays with a shape

Inside `nextToken`, the model works on _tensors_. A tensor is a flat array of
numbers plus a _shape_ that says how to read it. In JavaScript you might write
one like this:

```js
const hidden = {
  data: new Float32Array(1 * 5 * 768),
  shape: [1, 5, 768],
};
```

Each entry of the shape is an _axis_, and each axis means something. Here the
first is the batch (how many prompts at once: 1), the second is the sequence
(how many tokens: 5), and the third is the embedding (how many numbers describe
one token: 768). The first token's numbers are `data[0]` to `data[767]`, the
second's start at `data[768]`, and so on.

The shape is where the bugs live. Suppose two axes happen to have the same
length and the code mixes them up. Nothing crashes. The code reads the right
numbers in the wrong order and returns garbage that looks like any other
numbers.

## What's inside GPT-2

GPT-2's recipe fits on one screen. The batch axis is left out here, since the
page always runs one prompt:

```text
token ids                              [Seq]
  │ look each id up in a table          wte: 50,257 × 768
  │ add a row for each position         wpe:  1,024 × 768
  ▼
hidden                                 [Seq, 768]
  │ ┌─ repeat 12 times ────────────────────────────────┐
  │ │ attention: each token looks back at the earlier  │
  │ │   ones, in 12 heads of 64 numbers each           │
  │ │ MLP: each token on its own, 768 → 3,072 → 768    │
  │ └──────────────────────────────────────────────────┘
  │ normalize, then score against every token
  │                                     768 × 50,257
  ▼
scores                                 [Seq, 50,257]
```

In words:

- **Attention** is the step where tokens see each other. The 768 numbers of a
  token are split into 12 _heads_ of 64, and each head looks for a different
  kind of connection between tokens.
- **MLP** is a small neural network applied to each token alone: it widens the
  768 numbers to 3,072, then narrows them back.
- **Normalize** rescales each token's numbers to a steady range before the
  next step reads them. It happens inside every block too; the diagram shows
  only the last one.

`nextToken` reads the last row of `scores`: the scores for the token after the
prompt.

Attention only looks backward. Token 3 can see tokens 1 to 3 and never token 4,
since token 4 isn't written yet when it's predicted. GPT-2 enforces that with a
mask, a precomputed 1,024 × 1,024 table of which position may see which. The
mask and the position table `wpe` both stop at 1,024, which is why GPT-2 reads
at most 1,024 tokens.

The 124 million weights are the numbers in those tables (`wte`, `wpe`, and the
ones inside each of the 12 blocks), 148 tensors in all. The file that holds
them is called a _checkpoint_. Training chose the numbers. The code that uses
them is just the recipe above.

## ONNX: the model as a file

Models are usually built in Python, with PyTorch. To run one anywhere else, you
export it to [ONNX](https://onnx.ai/), a standard file format for models. An
ONNX file holds a _graph_: a list of steps, each an _operator_ such as `MatMul`
(matrix multiply), `Add`, or `Softmax`, each reading the outputs of earlier
steps. Think of a spreadsheet where every cell is a formula over other cells.

So an ONNX file is the model's code, not just its numbers. The whole recipe
from the diagram is in there, written out down to each multiply and add. Here
are three lines from the attention of GPT-2's first block, with the names
shortened:

```text
"MatMul_output_0"  = MatMul ("Transpose_output_0", "Transpose_3_output_0")
"Div_output_0"     = Div ("MatMul_output_0", "Add_output_0")
"Softmax_output_0" = Softmax <axis = -1> ("Add_1_output_0")
```

Each line names its output, the operator, and the outputs it reads. What each
operator computes is fixed by the ONNX specification, so any program that
implements the operators can run the model, with no Python and no PyTorch.

Here is how GPT-2's graph begins, in ONNX's text format:

```text
torch_jit (int64[batch_size, sequence_length] input_ids, …) => (float[batch_size, sequence_length, 50257] logits, …)
```

It names the inputs and outputs and gives their shapes. `batch_size` and
`sequence_length` are names, not numbers: the file leaves them open. `logits`
is what we called scores.

The graph has 3,095 steps, and here's the surprise: most of them never touch
the weights. 1,215 are constants, and hundreds more compute _shapes_: "How long
is the prompt?" "Take that, times 12." PyTorch records the code a model runs,
and model code asks for sizes all the time, as in `x.view(x.size(0), -1)`. Keep
this in mind; it comes back later.

An ONNX file can carry the weights too, and Hugging Face's export of GPT-2
does. Loam keeps the two apart. It reads the graph, 3.5 MB of text once the
weights are taken out, at build time, and the page downloads only the
checkpoint. Hugging Face ships GPT-2's checkpoint as
[safetensors](https://huggingface.co/docs/safetensors/): a JSON header, then
raw bytes. One entry from the header of the file the demo loads:

```json
"transformer.wte.weight": { "dtype": "F32", "shape": [50257, 768], "data_offsets": [0, 154389504] }
```

In JavaScript terms: `JSON.parse` the header, then for each entry make a
`Float32Array` over its bytes. The offsets count from the end of the header.

## Two ways to run a model

The common way to run an ONNX file is a _runtime_.
[onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/), which
[transformers.js](https://huggingface.co/docs/transformers.js/) uses to run
models in the browser, loads the graph as data and walks it at run time. For
each step it calls a built-in _kernel_, a tuned implementation of one operator.
One runtime runs any model you hand it. You can swap models without rebuilding
anything. And its kernels have years of tuning behind them, WebGPU included.

Loam takes the other road: it _compiles_. Given a graph at build time, it writes
a Wado program that performs exactly that graph's steps and nothing else. If
you've used a template engine, it's the difference between one that reads
templates while serving pages and one that turns each template into a
JavaScript function during the build. Both render the same HTML. They differ in
when the work happens and what ships.

Neither is better in general; they put the work in different places:

- A runtime is one engine for every model. A new model is a new file, not a new
  build.
- A compiler needs one build per model. In return, the output contains only the
  kernels this model uses, and the build itself becomes a place to catch
  mistakes before anything runs.

The rest of this post is about that last point.

## Shapes, checked like TypeScript types

numpy, Python's array library, is dynamic in the way JavaScript is: it checks
shapes when a line runs. Multiply a 5 × 768 matrix by another 5 × 768 one and
you get a `ValueError`, since matrix multiplication needs the inner sizes to
match. That's the good case: the error names the problem.

numpy also _broadcasts_, which means it stretches a smaller array to fit a
larger one:

```python
x = np.ones((5, 1))
y = np.ones(5)
(x + y).shape   # (5, 5)
```

If `y` was meant to line up with `x`'s rows, you wanted 5 numbers and got 25,
without a word. Broadcasting is still a feature: it's how you add one bias
vector to every row without writing a loop. That's the flexibility a dynamic
library gives you, and it cuts both ways, much like JavaScript letting
`"1" + 1` through.

Loam gives each axis a name and puts the names into the type. A tensor of
hidden states is a `Tensor<f32, [Batch, Seq, Embed]>`: `f32` numbers, three
axes, and which axis is which. Here is the matrix multiply kernel, simplified
(the real one also accepts any number of leading axes):

```wado
fn matmul<M, K, N>(a: &Tensor<f32, [M, K]>, b: &Tensor<f32, [K, N]>) -> Tensor<f32, [M, N]>
```

Read it like a TypeScript generic function. `K` appears in both inputs, so both
must name the same axis there, and it's gone from the result, because
multiplying consumes it:

- `[Seq, Embed]` times `[Embed, Inner]` gives `[Seq, Inner]`.
- `[Seq, Embed]` times `[Inner, Embed]` doesn't compile: `K` would have to be
  both `Embed` and `Inner`. It's the same kind of error as passing a `string`
  where a `number` goes.

## What Loam writes for GPT-2

The ONNX file only says `[50257, 768]`; it never says which axis is the
vocabulary. So the import that runs Loam names the axes, a few patterns at a
time:

```wado
use gpt2 from "./gpt2.onnxtext" with {
    generator: {
        module: "../../src/generator.wado", // Loam
        inputs: ["./gpt2-header.safetensors"],
        options: {
            layout: [
                { pattern: "transformer.wte.weight", axes: ["Vocab", "Embed"] },
                { pattern: "*mlp.c_fc.weight", axes: ["Embed", "Inner"] },
                // …
            ],
        },
    },
};
```

With those names, here is the function Loam writes for the whole model:

```wado
pub fn forward(
    input_ids: &Tensor<i64, [Batch, Seq]>,
    attention_mask: &Tensor<i64, [Batch, Seq]>,
    weights: &Weights,
) -> Tensor<f32, [Batch, Seq, Vocab]>
```

Token ids in, one score per vocabulary entry for every position out.
`attention_mask` marks which tokens are real; the page passes all ones.

The body is one line per step that survives the build (more on that below), and
it reads like the diagram. Each name comes
straight from the step's name in the ONNX graph. Here's "add a row for each
position":

```wado
let _transformer_Add_output_0 = zip(
    &_transformer_wte_Gather_output_0,
    &_transformer_wpe_Gather_output_0,
    |x, y| x + y,
);
```

Most steps are calls like `matmul`, whose signature relates the axes, so the
Wado compiler checks them. A few, such as reshaping, can't state the relation
in a signature. Those take the axis names Loam worked out and trust them.

Code that calls the model uses the names too. It writes `gpt2::Vocab::EXTENT`
rather than `50257`, so the caller can't disagree with the model about the size
of the vocabulary.

## Most of the graph disappears at build time

Remember the steps that compute shapes? Loam runs them during the build. Once
it knows that the embedding is 768 wide, "take the width, divide by 12" is just
64, and the step is gone. Three steps out of four vanish this way: of the 3,095,
about 750 are left in the Wado that Loam writes.

The prompt's length is the one size the build can't know. Loam carries it as a
name, `sequence_length`, through every step that uses it. Sometimes a step needs
a fact about it that the build can't prove. The attention mask is a 1,024-row
table, so slicing it to the prompt only works if `sequence_length` is at most
1,024. Loam turns each such fact into a check at the top of `forward`:

```wado
refuse(unmet(
    -dim_sequence_length + 1024,
    "/transformer/h.0/attn/Slice_3_output_0 = Slice: sequence_length must be at most 1024",
));
```

`unmet` fails when the number is negative: here, when the prompt is longer than
1,024 tokens. The message names the step that needed the fact. GPT-2's `forward`
starts with five of these checks, all before the first kernel runs.

## Checking the weights twice

The checkpoint gets the same treatment, at two moments:

- At build time, Loam reads the safetensors header, only the header, and checks
  every tensor's shape against the graph.
- At load time, the generated loader checks the bytes it is actually given,
  since those needn't come from the same file.

A mismatch names the tensor and the axis. From Loam's tests on a small GPT-2:

```text
transformer.wte.weight: axis Embed is 64 in the checkpoint and 32 in the graph
```

Loam itself runs inside a sandbox. It's a _Kiln generator_: Kiln is how Wado
runs code at build time. Kiln runs every generator as Wasm, with no access to
your files or the network beyond the inputs the import names. A build script in
most ecosystems runs with all of your permissions. That matters when the input
is a model file downloaded from the internet.

## Running it in the browser

Loam's GPT-2 example is a small library: the tokenizer, and a `Model` that
loads a checkpoint and picks the next token. The page wraps it in about 50
lines of Wado, which export the three functions the worker calls:

```wado
export fn load(checkpoint: ByteList) -> Result<(), String> { … }
export fn encode(text: String) -> List<i32> { … }
export fn next_token(ids: List<i32>) -> i32 { … }
```

`load` takes bytes, not a file path. That's why the same library runs from the
command line, where a program reads the file from disk, and in the page, where
the worker fetches it.

The worker does the rest, off the main thread:

1. It transpiles the component into an ES module with jco, right in the browser.
2. Meanwhile, it downloads Hugging Face's `model.safetensors` with a progress
   bar, and checks its SHA-256 with `crypto.subtle`.
3. It converts the file to the layout the graph expects. The two differ in two
   ways, and a plain JavaScript function fixes both:
   - Hugging Face names the tensors without the graph's `transformer.` prefix.
   - Hugging Face scores the output with the token table itself. The graph
     wants a copy of it with rows and columns swapped.
4. It hands the bytes to `load`, then runs the loop from the start of this post.

## How we know the numbers are right

A model that returns wrong numbers still returns numbers, so Loam is tested
against a reference answer: onnxruntime, run for its outputs. Every operator
Loam supports has small test models, each built through Loam and run, with the
result compared to onnxruntime's. ONNX's own test models, which ship with their
expected outputs, run the same way. And GPT-2, built through Loam, picks the
same tokens onnxruntime picks for the same prompt.

## Where it stands

The demo shows the design working on a real model. It doesn't show speed.

- It runs on the CPU only.
- It has no _KV cache_ yet. To write the 9th token, the model reruns over
  tokens 1 to 8 from scratch, though it already did most of that work for the
  8th. Generation gets slower as the text grows, and you'll feel it.
- It downloads 548 MB and needs a few GB of memory, and Chrome or Chromium 137+
  for JavaScript Promise Integration (JSPI).

So there are no speed numbers here. The CPU path exists to get the answers
right. Speed is a question for the WebGPU backend, and that's when we'll talk
about it.

## What's next

- **A KV cache.** GPT-2's graph already returns what its attention computed for
  each token, and ONNX exports a second graph that takes it back, so each step
  computes only the new token.
- **WebGPU.** A second backend that runs the kernels on the GPU, and the first
  point where performance is worth measuring.
- **int4 weights.** 4 bits per weight instead of 32, which shrinks the weights
  toward an eighth of today's download.
- **More models.** Built-in axis names for common model families such as Llama,
  so an import no longer lists them by hand.

Try the [demo](https://wado-lang.org/gpt2/), read
[`package-loam`](https://github.com/wado-lang/wado/tree/main/package-loam), or
see the design in [WEP: Loam](https://github.com/wado-lang/wado/blob/main/docs/wep-2026-09-20-loam.md).
