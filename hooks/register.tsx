import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, DecisionKind } from '../types'

const PANE = 'decisions'
const COMMAND = 'decisions'
const TOOL = 'note_decision'
const TOOL_ID = 'mcp__decision-log__note_decision'
const FILE_OPTION = 'decision-log.writeDecisionsFile'
const FILE = 'DECISIONS.md'
const FILE_HEADER =
  '# Decisions\n\nImplicit decisions Claude made while working, logged by the decision-log mod. One section per session.\n'

const KINDS: readonly DecisionKind[] = ['default', 'assumption', 'convention', 'scope']
const KIND_COLOR: Record<DecisionKind, string> = {
  default: 'suggestion',
  assumption: 'warning',
  convention: 'success',
  scope: 'error',
}

// Change a tag when its value's fields change: an earlier version's value
// outlives a reload and is read as the initial one instead.
const decisions = atom({ plugin: 'decision-log', key: 'decisions' } as const, [], {
  shape: 'decisions-1',
})
const asks = atom({ plugin: 'decision-log', key: 'asks' } as const, [], {
  shape: 'asks-1',
})

// A managed plugin passes prompt.compose on past this one, so the rules ride
// in the tool's description and a reminder beside each prompt instead.
const RULES = `Record an implicit decision so the user can review it in their Decisions pane.

While you work, call this tool each time you make a choice the user did not explicitly ask for and might have made differently. Log it as you make it, one decision per call, in one sentence. The kinds:
- default: a value or tool you picked (library, flag, file location, naming, format)
- assumption: something you assumed about the user (intent, skill, preferences, environment)
- convention: a repo convention you inferred and followed
- scope: something you chose not to do, deferred, or cut

Skip choices the request, the code or a tool's output already settled. Do not mention the log in your replies.`

const REMINDER = `Decision log: while doing this, call ${TOOL_ID} for each implicit choice (default, assumption about the user, repo convention, scope cut) as you make it.`

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// Module variables start over on a reload; both only save work.
let writtenCount = -1
let summary: { asks: number; text: string } | undefined

async function summarize($: EngineInterface, list: readonly string[]) {
  if (list.length === 0) return '(no prompt recorded)'
  if (summary?.asks === list.length) return summary.text

  const numbered = list.map((ask, i) => `${i + 1}. ${clip(oneLine(ask), 600)}`).join('\n')
  const done = await $.model.complete({
    model: 'haiku',
    prompt: `Summarize in one or two sentences what the user asked for across this coding session. Their prompts, in order:\n${numbered}\n\nReply with the summary only.`,
  })
  const text = done.isAnswered ? oneLine(done.text) : clip(oneLine(list[0] ?? ''), 300)
  summary = { asks: list.length, text }

  return text
}

async function writeFile($: EngineInterface) {
  const list = await read($, decisions)
  if (list.length === 0) return false

  const sessionId = await $.session.id()
  const asked = await summarize($, await read($, asks))
  const open = `<!-- decision-log:${sessionId} -->`
  const close = `<!-- /decision-log:${sessionId} -->`
  const rows = list.map(d => {
    const why = d.why ? ` _Why:_ ${d.why}` : ''
    const instead = d.alternatives ? ` _Instead of:_ ${d.alternatives}` : ''
    const where = d.agentId ? `turn ${d.turn}, subagent` : `turn ${d.turn}`
    return `- **${d.kind}**: ${d.decision}${why}${instead} (${where})`
  })
  const block = [
    open,
    `## ${list[0]?.at.slice(0, 10) ?? ''} · session ${sessionId.slice(0, 8)}`,
    '',
    `**Asked:** ${asked}`,
    '',
    ...rows,
    close,
  ].join('\n')

  const existing = (await $.fs.exists(FILE)) ? await $.fs.read(FILE) : FILE_HEADER
  const start = existing.indexOf(open)
  const end = existing.indexOf(close)
  const text =
    start >= 0 && end > start
      ? existing.slice(0, start) + block + existing.slice(end + close.length)
      : `${existing.trimEnd()}\n\n${block}\n`

  await $.fs.write(FILE, text)
  writtenCount = list.length

  return true
}

export const register: Register = (on, options) => {
  const isFileOn = options.writeDecisionsFile === true

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description: RULES,
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          decision: { type: 'string', description: 'What you chose, in one sentence.' },
          why: { type: 'string', description: 'What the choice rests on.' },
          alternatives: { type: 'string', description: 'What you could have done instead.' },
        },
        required: ['kind', 'decision', 'why'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: COMMAND,
      description: 'Decision log: open the pane, or `file on|off`, `write`, `clear`',
    })
    void $.ui.open({ id: PANE, title: 'Decisions' })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta !== undefined || e.text.trim() === '') return next(e)

    await update($, asks, list => [...list, clip(e.text.trim(), 2000)].slice(-50))

    return next({ ...e, context: [...(e.context ?? []), REMINDER] })
  })

  on('tool.call', { tool: TOOL_ID }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const decision = oneLine(String(input.decision ?? ''))
    if (decision === '') return { deny: `${TOOL} needs a decision.` }

    const kind = KINDS.find(k => k === input.kind) ?? 'default'
    const alternatives = oneLine(String(input.alternatives ?? ''))
    const entry: Decision = {
      id: e.tool_use_id,
      kind,
      decision,
      why: oneLine(String(input.why ?? '')),
      ...(alternatives === '' ? {} : { alternatives }),
      turn: (await read($, asks)).length,
      at: new Date().toISOString(),
      ...(e.agentId === undefined ? {} : { agentId: e.agentId }),
    }
    await update($, decisions, list => [...list, entry].slice(-500))

    return { result: 'Logged.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isFileOn && e.agentId === undefined) {
      const count = (await read($, decisions)).length
      if (count !== writtenCount) await writeFile($)
    }

    return done
  })

  on('session.end', async ($, e, next) => {
    if (isFileOn) await writeFile($)
    if (e.reason === 'clear') {
      // A /clear starts a new session id with no session.start.
      await update($, decisions, () => [])
      await update($, asks, () => [])
      writtenCount = -1
      summary = undefined
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'file on' || arg === 'file off') {
      const { deny } = await $.config.set({ key: FILE_OPTION, value: arg === 'file on' })
      if (deny !== undefined) return { text: `Could not change the setting: ${deny}` }
      return {
        text: arg === 'file on' ? `${FILE} is on: it updates at the end of each turn.` : `${FILE} is off.`,
      }
    }
    if (arg === 'write') {
      return { text: (await writeFile($)) ? `Wrote this session to ${FILE}.` : 'No decisions logged yet.' }
    }
    if (arg === 'clear') {
      await update($, decisions, () => [])
      return { text: 'Cleared this session’s decisions.' }
    }

    await $.ui.open({ id: PANE, title: 'Decisions' })
    return { text: 'Decisions pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, decisions)
    const prompts = await read($, asks)
    const width = Math.max(20, e.props.bodyColumns)
    const room = Math.max(1, Math.floor(((e.viewport?.rows ?? 24) - 4) / 3))
    const shown = list.slice(-room)
    const status = `${list.length} logged · ${FILE} ${isFileOn ? 'on' : 'off'}`

    return (
      <Box flexDirection="column">
        <Text dimColor>{status}</Text>
        {list.length === 0 && <Text dimColor>No decisions yet.</Text>}
        {shown.map((d, i) => {
          const isNewTurn = i === 0 || shown[i - 1]?.turn !== d.turn
          const ask = prompts[d.turn - 1]
          return (
            <Box flexDirection="column" marginTop={isNewTurn ? 1 : 0}>
              {isNewTurn && (
                <Text bold>{clip(`Turn ${d.turn}${ask ? `: ${oneLine(ask)}` : ''}`, width)}</Text>
              )}
              <Box flexDirection="row">
                <Text color={KIND_COLOR[d.kind]}>{d.kind.padEnd(11)}</Text>
                <Text>{d.decision}</Text>
              </Box>
              {d.why !== '' && <Text dimColor>{`           why: ${d.why}`}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
