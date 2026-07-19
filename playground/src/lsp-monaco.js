// Wires the wado-lsp worker (runtime/lsp-client.js) onto Monaco: markers from
// pushed diagnostics, plus hover, definition, references, document highlight,
// semantic tokens, and inlay hints providers.

const DOCUMENT_URI = "file:///playground.wado";
const DEBOUNCE_MS = 200;

const toMonacoPosition = (pos) => ({ lineNumber: pos.line + 1, column: pos.character + 1 });
const fromMonacoPosition = (pos) => ({ line: pos.lineNumber - 1, character: pos.column - 1 });
const toMonacoRange = (range) => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
});

const MARKER_SEVERITY = { 1: 8, 2: 4, 3: 2, 4: 1 }; // LSP severity → monaco.MarkerSeverity

export async function attachWadoLsp(monaco, editor, runtimeBase) {
  const { WadoLsp } = await import(new URL("lsp-client.js", runtimeBase));
  const lsp = new WadoLsp(new URL("lsp-worker.js", runtimeBase));
  const model = editor.getModel();

  lsp.onNotification("textDocument/publishDiagnostics", ({ uri, diagnostics }) => {
    if (uri !== DOCUMENT_URI) return;
    monaco.editor.setModelMarkers(
      model,
      "wado-lsp",
      diagnostics.map((d) => ({
        ...toMonacoRange(d.range),
        message: d.message,
        severity: MARKER_SEVERITY[d.severity ?? 1] ?? 8,
        source: d.source,
        // LSP DiagnosticTag values match Monaco MarkerTag (Unnecessary=1,
        // Deprecated=2), so pass them straight through. Without this the
        // dead-code lint's Unnecessary tag is lost and the range never fades.
        tags: d.tags,
      })),
    );
  });

  const init = await lsp.initialize();
  lsp.didOpen(DOCUMENT_URI, model.getValue());

  let pending = null;
  model.onDidChangeContent(() => {
    clearTimeout(pending);
    pending = setTimeout(() => lsp.didChange(DOCUMENT_URI, model.getValue()), DEBOUNCE_MS);
  });

  const positionParams = (position) => ({
    textDocument: { uri: DOCUMENT_URI },
    position: fromMonacoPosition(position),
  });

  const localLocations = (result) => {
    const locations = Array.isArray(result) ? result : result ? [result] : [];
    return locations
      .filter((loc) => loc.uri === DOCUMENT_URI)
      .map((loc) => ({ uri: model.uri, range: toMonacoRange(loc.range) }));
  };

  const LANG = "wado";
  monaco.languages.registerHoverProvider(LANG, {
    provideHover: async (_m, position) => {
      const h = await lsp.request("textDocument/hover", positionParams(position));
      if (!h) return null;
      return {
        contents: [{ value: h.contents.value ?? String(h.contents) }],
        range: h.range && toMonacoRange(h.range),
      };
    },
  });

  monaco.languages.registerDefinitionProvider(LANG, {
    provideDefinition: async (_m, position) =>
      localLocations(await lsp.request("textDocument/definition", positionParams(position))),
  });

  monaco.languages.registerReferenceProvider(LANG, {
    provideReferences: async (_m, position) =>
      localLocations(
        await lsp.request("textDocument/references", {
          ...positionParams(position),
          context: { includeDeclaration: true },
        }),
      ),
  });

  monaco.languages.registerDocumentHighlightProvider(LANG, {
    provideDocumentHighlights: async (_m, position) => {
      const highlights = await lsp.request("textDocument/documentHighlight", positionParams(position));
      return (highlights ?? []).map((h) => ({ range: toMonacoRange(h.range), kind: h.kind }));
    },
  });

  const legend = init.capabilities.semanticTokensProvider?.legend;
  if (legend) {
    monaco.languages.registerDocumentSemanticTokensProvider(LANG, {
      getLegend: () => legend,
      provideDocumentSemanticTokens: async () => {
        const tokens = await lsp.request("textDocument/semanticTokens/full", {
          textDocument: { uri: DOCUMENT_URI },
        });
        return { data: new Uint32Array(tokens?.data ?? []), resultId: null };
      },
      releaseDocumentSemanticTokens: () => {},
    });
  }

  monaco.languages.registerInlayHintsProvider(LANG, {
    provideInlayHints: async (_m, range) => {
      const hints = await lsp.request("textDocument/inlayHint", {
        textDocument: { uri: DOCUMENT_URI },
        range: {
          start: fromMonacoPosition(range.getStartPosition()),
          end: fromMonacoPosition(range.getEndPosition()),
        },
      });
      return {
        hints: (hints ?? []).map((h) => ({
          position: toMonacoPosition(h.position),
          label: typeof h.label === "string" ? h.label : h.label.map((p) => p.value).join(""),
          kind: h.kind,
          paddingLeft: h.paddingLeft,
          paddingRight: h.paddingRight,
        })),
        dispose: () => {},
      };
    },
  });

  return lsp;
}
