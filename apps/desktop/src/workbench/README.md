# workbench

## Responsibility
The IDE shell: activity bar, panels (file tree, git, search, settings,
extensions marketplace, AI assistant), command palette, quick open, status
bar, layout/resize state. This is the largest layer and the one most of the
existing `renderer/src/components/modules/*` will eventually move into.

## Allowed imports
`kernel`, `platform`, `editor`, `extension-host` (to list/enable/disable
extensions and render their contributed commands/status-bar items/themes),
`@sde-code/protocol`.

## Why it exists
Naming this layer explicitly — rather than leaving "the whole renderer" as
one undifferentiated pile — is what makes the *next* boundary (workbench
must not reach past extension-host into raw extension code, must not
reimplement platform services locally) something the linter can catch
instead of something we just try to remember.
