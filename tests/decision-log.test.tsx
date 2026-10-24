import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'decision-log',
  component: 'Pane',
  requestId: 'decisions',
  props: {
    title: 'Decisions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Each hook here stands for the engine beneath the plugin.
const engine = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'decisions' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
}

const NOTE = {
  tool: 'mcp__decision-log__note_decision',
  kind: 'convention',
  decision: 'Used pnpm for installs',
  why: 'pnpm-lock.yaml is in the repo',
} as const

test('a logged decision shows in the pane under its turn', async ($, on) => {
  engine(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'add a lint script' })
  await $.tool.call(NOTE)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Used pnpm/ }))?.text).toBe('Used pnpm for installs')
    expect((await ui.find({ type: 'Text', text: /Turn 1/ }))?.text).toBe('Turn 1: add a lint script')
    expect((await ui.find({ type: 'Text', text: /why:/ }))?.text).toContain('pnpm-lock.yaml')
    await ui.unmount()
  }
})

test('with the file on, a turn writes one section with the summary', { options: { writeDecisionsFile: true } }, async ($, on) => {
  const writes: string[] = []
  engine(on)
  on('session.id', () => ({ value: 'abcdef1234567890' }))
  on('fs.exists', () => ({ value: writes.length > 0 }))
  on('fs.read', () => ({ value: writes.at(-1) ?? '' }))
  on('fs.write', (_, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'Add a lint script.', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'add a lint script' })
  await $.tool.call(NOTE)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'completed' })
  await $.tool.call({ ...NOTE, kind: 'scope', decision: 'Skipped CI changes' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'completed' })

  const file = writes.at(-1) ?? ''
  expect(file.match(/<!-- decision-log:abcdef1234567890 -->/g)?.length).toBe(1)
  expect(file).toContain('**Asked:** Add a lint script.')
  expect(file).toContain('- **convention**: Used pnpm for installs')
  expect(file).toContain('- **scope**: Skipped CI changes')
})
