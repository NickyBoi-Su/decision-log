export type DecisionKind = 'default' | 'assumption' | 'convention' | 'scope'

export type Decision = {
  id: string
  kind: DecisionKind
  decision: string
  why: string
  alternatives?: string
  // How many prompts the person had sent when it was logged.
  turn: number
  at: string
  agentId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'decision-log': {
      decisions: Shaped<Decision[]>
      asks: Shaped<string[]>
    }
  }
}
