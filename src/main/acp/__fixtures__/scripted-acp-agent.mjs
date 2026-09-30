#!/usr/bin/env node
/**
 * A scripted ACP agent over stdio, for driving Orca's ACP client in tests.
 *
 * Why a real subprocess instead of mocking the SDK: the whole risk in this
 * layer is framing, stream plumbing, and lifecycle — buffering, backpressure,
 * a half-written line, an agent that exits mid-turn. A mock would exercise
 * none of it. This speaks newline-delimited JSON-RPC exactly as the protocol
 * requires, so the client's transport is what is actually under test.
 *
 * Modes (argv[2]):
 *   echo    — initialize, session/new, then echo each prompt back as chunks
 *   silence — read input but never reply (handshake must time out / fail closed)
 *   crash   — exit non-zero immediately (startup failure)
 *   perms   — like echo, but asks for permission before answering
 *   stderr  — write to stderr then crash (diagnostics path)
 */
import readline from 'node:readline'

const mode = process.argv[2] ?? 'echo'

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params })
}

if (mode === 'crash') {
  process.stderr.write('scripted agent: refusing to start\n')
  process.exit(3)
}

const SESSION_ID = 'agent-session-1'
let nextRequestId = 1
// `silence` and `stderr` both withhold replies, so a handshake against them
// fails and the client must surface the failure rather than hang.
const repliesEnabled = mode === 'echo' || mode === 'perms'
/** Resolves the promise a pending client request is waiting on, keyed by request id. */
const pendingResponses = new Map()

function awaitResponse(id) {
  return new Promise((resolve) => pendingResponses.set(id, resolve))
}

function sessionUpdate(update) {
  notify('session/update', { sessionId: SESSION_ID, update })
}

async function handlePrompt(id, params) {
  const text = (params.prompt ?? []).map((block) => block.text ?? '').join('')

  if (mode === 'perms') {
    const requestId = nextRequestId++
    // Why the promise is created before sending: the client's reply can arrive
    // on the same tick, so registering afterwards would miss it.
    const decisionPromise = awaitResponse(requestId)
    send({
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/request_permission',
      params: {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: 'tool-1', title: 'Run the tests' },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
        ]
      }
    })
    const decision = await decisionPromise
    sessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `decision=${decision?.outcome?.outcome ?? 'none'}` }
    })
  }

  sessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-1',
    title: 'Run tests',
    name: 'pnpm test',
    status: 'in_progress',
    rawInput: { command: 'pnpm test', args: ['--run'] }
  })
  sessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tool-1',
    status: 'completed',
    rawOutput: '3 tests passed',
    content: [{ type: 'content', content: { type: 'text', text: '3 tests passed' } }]
  })
  // Two chunks, so the client must accumulate rather than assume one message.
  sessionUpdate({
    sessionUpdate: 'agent_message_chunk',
    messageId: 'assistant-1',
    content: { type: 'text', text: `echo:${text}` }
  })
  sessionUpdate({
    sessionUpdate: 'agent_message_chunk',
    messageId: 'assistant-1',
    content: { type: 'text', text: '!' }
  })
  sessionUpdate({
    sessionUpdate: 'plan',
    entries: [{ content: 'step one', status: 'pending', priority: 'high' }]
  })
  reply(id, { stopReason: 'end_turn' })
}

readline
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      return
    }

    // A response to a request we sent (the permission prompt).
    if (message.id !== undefined && message.method === undefined) {
      const resolve = pendingResponses.get(message.id)
      if (resolve) {
        pendingResponses.delete(message.id)
        resolve(message.result)
      }
      return
    }

    if (message.method === 'initialize') {
      if (repliesEnabled) {
        reply(message.id, {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: 'scripted-agent', version: '1.0.0' }
        })
      }
      return
    }

    if (message.method === 'session/new') {
      if (repliesEnabled) {
        reply(message.id, { sessionId: SESSION_ID })
      }
      return
    }

    if (message.method === 'session/prompt') {
      void handlePrompt(message.id, message.params)
      return
    }

    if (message.method === 'session/cancel') {
      return
    }

    // Unknown methods get a proper JSON-RPC error so the client surfaces it.
    if (message.id !== undefined) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `scripted agent: unknown method ${message.method}` }
      })
    }
  })
  .on('close', () => {
    process.exit(0)
  })

if (mode === 'stderr') {
  process.stderr.write('scripted agent: warning line one\n')
}
