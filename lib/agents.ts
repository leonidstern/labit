// Which coding agent runs a command, and the session it runs in.

// The coding agents labit knows: what each sets in the shells it starts (so a command can tell which agent ran it).
// Amp comes before Claude: it also sets CLAUDECODE. Copilot sets nothing: LAB_AGENT=copilot.
export const AGENTS: Record<string, { name: string; env: string[] }> = {
  amp: { name: 'Amp', env: ['AMP_CURRENT_THREAD_ID'] },
  codex: { name: 'Codex', env: ['CODEX_THREAD_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'] },
  cursor: { name: 'Cursor', env: ['CURSOR_AGENT'] },
  antigravity: { name: 'Antigravity', env: ['ANTIGRAVITY_AGENT'] },
  gemini: { name: 'Gemini', env: ['GEMINI_CLI'] },
  opencode: { name: 'opencode', env: ['OPENCODE_CLIENT', 'OPENCODE'] },
  copilot: { name: 'Copilot', env: [] },
  claude: { name: 'Claude', env: ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID'] },
};
// A name or id to a known agent: "codex", "Codex", "claude-code", "cursor-agent", "agy".
const agentKind = (word: unknown = ''): string => {
  const w = String(word).toLowerCase();
  if (/\bagy\b/.test(w)) return 'antigravity';
  return Object.keys(AGENTS).find((k) => w.includes(k)) || '';
};
// Which agent runs this command: LAB_AGENT (any name), then each agent's own
// variables (Claude's last, as other agents run inside its shells), then AGENT / AI_AGENT when they name a known
// agent (inherited more easily: Claude Code sets AI_AGENT). Unknown: Claude, as before.
function agentNow(env: NodeJS.ProcessEnv = process.env): { kind: string; name: string } {
  const own = (env.LAB_AGENT || '').trim().slice(0, 30);
  if (own) return { kind: agentKind(own), name: AGENTS[agentKind(own)]?.name || own };
  const kind = Object.keys(AGENTS).find((k) => AGENTS[k].env.some((v) => env[v])) || agentKind(env.AGENT) || agentKind(env.AI_AGENT);
  return kind ? { kind, name: AGENTS[kind].name } : { kind: '', name: 'Claude' };
}

// The agent session running this command, if any: its id, a name for the page, a link and a resume command where the
// agent has them (Claude Code: CLAUDE_CODE_SESSION_ID; Codex: CODEX_THREAD_ID; Amp: AMP_CURRENT_THREAD_ID; Cursor:
// CURSOR_CONVERSATION_ID; opencode 2: OPENCODE_SESSION_ID, the ids their hooks get). Any other agent says its session in
// LAB_SESSION_ID (Cursor's start hook still sets it, though the Cursor CLI doesn't pass it on to shells).
// The model the session runs on, for the page: "Sonnet 5.5" from --model, LAB_MODEL or ANTHROPIC_MODEL, where an id
// like claude-sonnet-5-5 reads as "Sonnet 5.5". Agents don't put their model in the shell's environment: they say it.
const modelName = (m: unknown = ''): string => {
  const w = String(m).trim().replace(/\[.*\]$/, '');
  const id = /^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(w);
  if (id) return `${id[1][0].toUpperCase()}${id[1].slice(1).toLowerCase()} ${id[2]}${id[3] ? `.${id[3]}` : ''}`;
  return /^(opus|sonnet|haiku|fable)$/i.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.replace(/\s+/g, ' ').slice(0, 30);
};

export function mySession(asked?: string, model?: string) {
  const agent = agentNow();
  const env = process.env;
  const remote = agent.kind === 'claude' || !agent.kind ? env.CLAUDE_CODE_REMOTE_SESSION_ID || '' : '';
  const id = { claude: env.CLAUDE_CODE_SESSION_ID, codex: env.CODEX_THREAD_ID, amp: env.AMP_CURRENT_THREAD_ID, cursor: env.CURSOR_CONVERSATION_ID, opencode: env.OPENCODE_SESSION_ID }[agent.kind || 'claude'] || env.LAB_SESSION_ID || '';
  const name = asked || env.LAB_SESSION_NAME || (id ? `session ${id.slice(0, 8)}` : agent.name);
  const safe = /^[\w-]+$/.test(id);
  return {
    id,
    name: name.replace(/\s+/g, ' ').slice(0, 40),
    agent: agent.name,
    model: modelName(model || env.LAB_MODEL || env.ANTHROPIC_MODEL),
    kind: agent.kind,
    url: remote ? `https://claude.ai/code/${remote.replace(/^cse_/, 'session_')}` : agent.kind === 'amp' && safe ? `https://ampcode.com/threads/${id}` : '',
    resume: !safe || remote ? '' : { claude: `claude --resume ${id}`, codex: `codex resume ${id}`, amp: `amp threads continue ${id}`, opencode: `opencode --session ${id}` }[agent.kind || 'claude'] || '',
  };
}
