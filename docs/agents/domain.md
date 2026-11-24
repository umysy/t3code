# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/fork/GLOSSARY.md`**: the language for maintaining this fork (fork feature, fork hook, official release, fork update, and so on).
- **`docs/fork/adr/`**: decisions about how the fork is built, released, and kept in step with official releases.

Official T3 Code has no root glossary. Its shared vocabulary is in `docs/internals/glossary.md`; read it for product terms.

## File structure

```
/
├── docs/fork/
│   ├── GLOSSARY.md           ← fork-only vocabulary
│   └── adr/                  ← fork-only decisions
└── docs/internals/glossary.md ← official product vocabulary
```

Fork documents stay under `docs/fork/` so official updates never conflict with them.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, or a test name), use the term as defined in the relevant glossary. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in a glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007, but worth reopening because…_
