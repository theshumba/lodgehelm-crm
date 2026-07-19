#!/usr/bin/env node
// LodgeHelm CRM — MCP server (stdio, zero dependencies).
//
// A thin Model Context Protocol wrapper around the battle-tested CLI
// (scripts/crm.mjs): every tool call spawns the CLI, so MCP writes use the
// exact same field names, activity shapes and _modAt/_modBy stamping as the
// web app and terminal. No duplicated logic, no drift.
//
// Register once (user scope so it works from any directory):
//   claude mcp add -s user lodgehelm -- node /Users/theshumba/Documents/GitHub/lodgehelm-crm/scripts/mcp-server.mjs
//
// Requires serviceAccountKey.json at the repo root (gitignored) — same as the CLI.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'scripts', 'crm.mjs');

const lead = { type: 'string', description: 'Lead id or (part of) the business name' };
const dryRun = { type: 'boolean', description: 'Preview the write without touching Firestore' };

// tool name -> { description, inputSchema, args(input) -> CLI argv }
const TOOLS = {
  crm_today: {
    description: "The day's worklist: follow-ups due or overdue, callbacks and meetings today, and the top not-yet-contacted qualified leads.",
    schema: { limit: { type: 'number', description: 'Max rows (default 25)' } },
    args: i => ['today', ...(i.limit ? ['--limit', String(i.limit)] : [])],
  },
  crm_search: {
    description: 'Search leads by name, country, segment or owner. Filters: country, segment, stage 1-6, status (qualified|unqualified|crm|archive).',
    schema: {
      query: { type: 'string', description: 'Search text' },
      country: { type: 'string' }, segment: { type: 'string' },
      stage: { type: 'number' }, status: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['query'],
    args: i => ['search', i.query,
      ...(i.country ? ['--country', i.country] : []), ...(i.segment ? ['--segment', i.segment] : []),
      ...(i.stage ? ['--stage', String(i.stage)] : []), ...(i.status ? ['--status', i.status] : []),
      ...(i.limit ? ['--limit', String(i.limit)] : [])],
  },
  crm_show: {
    description: 'Full lead card: channels, contacts, funnel leak, angle, pipeline fields, notes and recent activity.',
    schema: { lead }, required: ['lead'],
    args: i => ['show', i.lead],
  },
  crm_call: {
    description: "Log a call exactly like the app does — sets the next step, due date and stage automatically. Outcomes: no-answer, gatekeeper, spoke, interested, not-interested, callback, voicemail, wrong-number.",
    schema: {
      lead, outcome: { type: 'string', description: 'no-answer|gatekeeper|spoke|interested|not-interested|callback|voicemail|wrong-number' },
      note: { type: 'string' }, callback: { type: 'string', description: 'YYYY-MM-DD or +Nd (for callback outcome)' }, dryRun,
    },
    required: ['lead', 'outcome'],
    args: i => ['call', i.lead, '--outcome', i.outcome,
      ...(i.note ? ['--note', i.note] : []), ...(i.callback ? ['--callback', i.callback] : []),
      ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_wa: {
    description: "Print the lead's wa.me link with the per-segment template prefilled. sent=true also logs it as sent (stage/next-step advance).",
    schema: { lead, sent: { type: 'boolean' }, dryRun }, required: ['lead'],
    args: i => ['wa', i.lead, ...(i.sent ? ['--sent'] : []), ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_note: {
    description: 'Add a note to a lead (appears in the app timeline).',
    schema: { lead, text: { type: 'string' }, dryRun }, required: ['lead', 'text'],
    args: i => ['note', i.lead, i.text, ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_next: {
    description: "Set the lead's next step and due date (followUpDate mirrors it).",
    schema: { lead, step: { type: 'string' }, due: { type: 'string', description: '+3d or YYYY-MM-DD' }, dryRun },
    required: ['lead', 'step'],
    args: i => ['next', i.lead, i.step, ...(i.due ? ['--due', i.due] : []), ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_done: {
    description: 'Mark the current next step done and optionally set the new one.',
    schema: { lead, newStep: { type: 'string' }, due: { type: 'string' }, dryRun }, required: ['lead'],
    args: i => ['done', i.lead, ...(i.newStep ? [i.newStep] : []), ...(i.due ? ['--due', i.due] : []), ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_meeting_done: {
    description: 'A meeting happened: stage to In discussion, stamps the meeting, next step "Send recap / proposal".',
    schema: { lead, note: { type: 'string' }, due: { type: 'string' }, when: { type: 'string', description: 'YYYY-MM-DDTHH:MM' }, dryRun },
    required: ['lead'],
    args: i => ['meeting-done', i.lead, ...(i.note ? ['--note', i.note] : []), ...(i.due ? ['--due', i.due] : []), ...(i.when ? ['--when', i.when] : []), ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_stage: {
    description: 'Move pipeline stage (1-6 or name: New, Researched, Contacted, Awaiting reply, In discussion, Won). lost="reason" archives as not interested.',
    schema: { lead, stage: { type: 'string' }, lost: { type: 'string', description: 'Archive with this lost reason instead' }, dryRun },
    required: ['lead', 'stage'],
    args: i => ['stage', i.lead, i.stage, ...(i.lost ? ['--lost', i.lost] : []), ...(i.dryRun ? ['--dry-run'] : [])],
  },
  crm_stats: {
    description: 'Pipeline counts per stage, qualified/bank split, activity last 7 days, calls today, follow-ups due.',
    schema: {},
    args: () => ['stats'],
  },
  crm_draft: {
    description: 'Ready-to-send outreach draft for a lead (email or whatsapp), in the house voice.',
    schema: { lead, channel: { type: 'string', description: 'email|whatsapp' } }, required: ['lead'],
    args: i => ['draft', i.lead, ...(i.channel ? ['--channel', i.channel] : [])],
  },
};

function runCli(argv) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...argv], {
      cwd: REPO, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += '\n[timed out after 60s]'; }, 60_000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, text: (out + (err ? '\n' + err : '')).trim() || '(no output)' });
    });
    child.on('error', e => { clearTimeout(timer); resolve({ code: 1, text: 'spawn failed: ' + e.message }); });
  });
}

function toolList() {
  return Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: { type: 'object', properties: t.schema || {}, ...(t.required ? { required: t.required } : {}) },
  }));
}

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async line => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'lodgehelm-crm', version: '1.0.0' },
    } });
    return;
  }
  if (method === 'notifications/initialized' || String(method || '').startsWith('notifications/')) return;
  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: toolList() } }); return; }
  if (method === 'tools/call') {
    const name = params && params.name;
    const input = (params && params.arguments) || {};
    const tool = TOOLS[name];
    if (!tool) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true } });
      return;
    }
    const { code, text } = await runCli(tool.args(input));
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: code !== 0 } });
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
});
