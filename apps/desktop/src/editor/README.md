# editor

## Responsibility
Everything specific to *editing text*, wrapping Monaco: model management
(open/dirty/save state per file), language configuration, editor-specific
commands (format, go-to-line, toggle comment), and the React binding around
`@monaco-editor/react`. Not file-tree, not panels, not tabs — just the
editing surface itself.

## Allowed imports
`kernel`, `platform`.

## Why it exists
The current `EditorArea.tsx` mixes Monaco setup with workbench-level concerns
(tab bar, layout). Separating "the editor" from "the shell around the editor"
means the editor module could theoretically be reused (e.g. a diff-review
tool, a notebook cell editor) without dragging in the whole workbench, and
means editor logic can be unit-tested without rendering the full app shell.
