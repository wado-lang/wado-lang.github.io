// Base Monarch grammar for Wado: instant keyword/string/comment coloring
// while the LSP warms up; semantic tokens refine it afterwards.
//
// The keyword tables mirror wado-compiler/src/syntax.rs (KEYWORDS +
// CONTEXTUAL_KEYWORDS). Generating this file from syntax.rs, like the
// TextMate grammar, is a planned follow-up in the wado repo.

const KEYWORDS = [
  "if", "else", "while", "for", "loop", "break", "continue", "return", "match",
  "fn", "let", "global", "const", "struct", "enum", "variant", "flags",
  "impl", "trait", "type", "resource", "world", "effect", "interface",
  "pub", "internal", "export", "mut", "async", "unique", "stores", "reactive",
  "use", "from", "import", "as", "with", "in", "of", "assert", "matches",
  // contextual
  "task", "do", "resume", "test",
];

const CONSTANTS = ["true", "false", "null", "self"];

export const wadoLanguage = {
  defaultToken: "",
  tokenPostfix: ".wado",

  keywords: KEYWORDS,
  constants: CONSTANTS,

  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"/, "string", "@string"],
      [/`/, "string", "@template"],
      [/\d[\d_]*\.\d[\d_]*([eE][+-]?\d+)?/, "number.float"],
      [/0x[0-9a-fA-F_]+/, "number.hex"],
      [/\d[\d_]*/, "number"],
      [
        /[a-zA-Z_][a-zA-Z0-9_]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@constants": "constant",
            "[A-Z].*": "type.identifier",
            "@default": "identifier",
          },
        },
      ],
      [/[{}()[\]]/, "@brackets"],
      [/(==|!=|<=|>=|&&|\|\||->|=>|\.\.[<=]?|[-+*\/%<>=!&|^~?])/, "operator"],
      [/[,;:.]/, "delimiter"],
    ],

    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],

    template: [
      [/\{\{/, "string"],
      [/\{/, { token: "delimiter.bracket", next: "@templateExpr" }],
      [/[^\\`{]+/, "string"],
      [/\\./, "string.escape"],
      [/`/, "string", "@pop"],
    ],

    templateExpr: [
      [/[^{}]+/, "identifier"],
      [/\}/, { token: "delimiter.bracket", next: "@pop" }],
    ],
  },
};

export const wadoLanguageConfiguration = {
  comments: { lineComment: "//" },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "`", close: "`", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "`", close: "`" },
  ],
};

// The landing page's palette: vermillion keywords, green strings, soft-ink
// comments on the warm paper code background.
export const wadoPaperTheme = {
  base: "vs",
  inherit: true,
  colors: {
    "editor.background": "#f6f3ec",
    "editor.foreground": "#1a1a1a",
    "editor.lineHighlightBackground": "#efeadf",
    "editorLineNumber.foreground": "#b5ae9f",
    "editorLineNumber.activeForeground": "#777268",
    "editorCursor.foreground": "#7a1c1c",
    "editor.selectionBackground": "#e4ddd0",
    "editorInlayHint.background": "#efeadf",
    "editorInlayHint.foreground": "#777268",
  },
  rules: [
    { token: "keyword", foreground: "7a1c1c" },
    { token: "constant", foreground: "7a1c1c" },
    { token: "string", foreground: "2f5a2f" },
    { token: "string.escape", foreground: "2f5a2f" },
    { token: "comment", foreground: "6b665b", fontStyle: "italic" },
    { token: "number", foreground: "1a5276" },
    { token: "number.float", foreground: "1a5276" },
    { token: "number.hex", foreground: "1a5276" },
    { token: "type.identifier", foreground: "3d3a33" },
    { token: "operator", foreground: "3d3a33" },
    // Semantic token types (LSP) resolve through the same rule names.
    { token: "type", foreground: "3d3a33" },
    { token: "struct", foreground: "3d3a33" },
    { token: "enum", foreground: "3d3a33" },
    { token: "interface", foreground: "3d3a33" },
    { token: "typeParameter", foreground: "3d3a33" },
    { token: "namespace", foreground: "3d3a33" },
    { token: "function", foreground: "1a1a1a", fontStyle: "bold" },
    { token: "method", foreground: "1a1a1a", fontStyle: "bold" },
    { token: "enumMember", foreground: "1a5276" },
    { token: "property", foreground: "1a1a1a" },
    { token: "parameter", foreground: "1a1a1a" },
    { token: "variable", foreground: "1a1a1a" },
  ],
};
