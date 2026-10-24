# decision-log

A Claude Code mod that shows, in a pane beside the chat, the implicit decisions Claude makes while it works: the defaults it picks, what it assumes about you, the repo conventions it follows, and what it leaves out. Handy in auto mode, where you can catch a wrong assumption before more work builds on it.

```
Turn 2: add a lint script
default     Used ruff instead of flake8
           why: pyproject.toml already configures ruff
scope       Left CI config unchanged
           why: not asked for
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install decision-log --marketplace NickyBoi-Su/decision-log
```

From a shell:

```
claude plugin install decision-log --marketplace NickyBoi-Su/decision-log
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `NickyBoi-Su/decision-log`, then Add plugin.

## Use

- The pane docks on the right in a terminal at least 144 columns wide; `/decisions` opens it at any width.
- `/decisions file on` keeps one `DECISIONS.md` in the project: a section per session with a summary of what you asked and every decision, updated at the end of each turn. Off by default.
- `/decisions write` writes it once; `/decisions clear` empties the session's list.

Decisions are self-reported by Claude through a `note_decision` tool, so it logs what it notices deciding, not everything.
