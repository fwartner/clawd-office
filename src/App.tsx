import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { type PresenceState, type Room, defaultPresenceColors } from './data'
import { useOffice, type OfficeAgent, type AgentCreateInput, type AgentUpdateInput, type ToastItem } from './office-provider'
import { characterSprites, getCharacterSprite, getSpriteAnimData, type CharacterSpriteSet, type SpriteAnimData } from './world'
import { WelcomeOnboarding } from './WelcomeOnboarding'
import { SettingsPanel } from './SettingsPanel'

// ── Toast notification component ─────────────────────
function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="alert">
          <span className="toast-message">{t.message}</span>
          <button className="toast-dismiss" onClick={() => onDismiss(t.id)} aria-label="Dismiss">&times;</button>
        </div>
      ))}
    </div>
  )
}

// ── Decision card component ──────────────────────────
function DecisionCard({ decision, agents, onUpdate }: {
  decision: { id: string; title: string; detail: string; status: string; proposedBy: string | null; createdAt: string }
  agents: OfficeAgent[]
  onUpdate: (id: string, input: { status?: string }) => Promise<boolean>
}) {
  const proposer = decision.proposedBy ? agents.find(a => a.id === decision.proposedBy) : null
  const statusColors: Record<string, string> = { proposed: '#ffd479', accepted: '#78f7b5', rejected: '#ff8b8b' }
  return (
    <div className="decision-card" style={{ borderLeftColor: statusColors[decision.status] || '#8792a8' }}>
      <div className="decision-head">
        <strong>{decision.title}</strong>
        <span className="decision-status" style={{ color: statusColors[decision.status] }}>{decision.status}</span>
      </div>
      <p className="decision-detail">{decision.detail}</p>
      <div className="decision-meta">
        {proposer && <span>Proposed by {proposer.name}</span>}
        <span>{safeTime(decision.createdAt)} · {relativeTime(decision.createdAt)}</span>
      </div>
      {decision.status === 'proposed' && (
        <div className="decision-actions">
          <button className="decision-accept" onClick={() => onUpdate(decision.id, { status: 'accepted' })}>Accept</button>
          <button className="decision-reject" onClick={() => onUpdate(decision.id, { status: 'rejected' })}>Reject</button>
        </div>
      )}
    </div>
  )
}

// ── Decision create form ─────────────────────────────
function DecisionForm({ agents, onSubmit, onClose }: {
  agents: OfficeAgent[]
  onSubmit: (input: { title: string; detail: string; proposedBy?: string }) => Promise<boolean>
  onClose: () => void
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    await onSubmit({
      title: fd.get('title') as string,
      detail: fd.get('detail') as string,
      proposedBy: (fd.get('proposedBy') as string) || undefined
    })
    onClose()
  }

  return (
    <form className="assign-form" onSubmit={handleSubmit}>
      <div className="assign-form-head">
        <strong>New Decision</strong>
        <button type="button" className="assign-close" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <label htmlFor="decision-title" className="visually-hidden">Title</label>
      <input ref={titleRef} id="decision-title" name="title" placeholder="Decision title" required className="assign-input" />
      <label htmlFor="decision-detail" className="visually-hidden">Detail</label>
      <textarea id="decision-detail" name="detail" placeholder="Decision detail" rows={3} required className="assign-input" />
      <label htmlFor="decision-proposer" className="visually-hidden">Proposed by</label>
      <select id="decision-proposer" name="proposedBy" className="assign-select">
        <option value="">No proposer</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button type="submit" className="assign-submit">Propose decision</button>
    </form>
  )
}

// ── Chat message component ───────────────────────────
function ChatPanel({ messages, agents, rooms, currentRoomId, onSend }: {
  messages: Array<{ id: string; fromAgentId: string; toAgentId: string | null; roomId: string | null; message: string; createdAt: string }>
  agents: OfficeAgent[]
  rooms: Array<{ id: string; name: string }>
  currentRoomId: string | null
  onSend: (input: { fromAgentId: string; roomId?: string; message: string }) => Promise<boolean>
}) {
  const [selectedRoom, setSelectedRoom] = useState(currentRoomId || rooms[0]?.id || '')
  const roomMsgs = messages.filter(m => m.roomId === selectedRoom).slice(-30)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight) }, [roomMsgs.length])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    const msg = (fd.get('message') as string)?.trim()
    const from = fd.get('fromAgent') as string
    if (!msg || !from) return
    onSend({ fromAgentId: from, roomId: selectedRoom, message: msg })
    ;(e.target as HTMLFormElement).reset()
  }

  return (
    <div className="chat-panel" role="tabpanel">
      <div className="chat-room-select">
        <label htmlFor="chat-room" className="visually-hidden">Room</label>
        <select id="chat-room" className="assign-select" value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}>
          {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
      <div className="chat-messages" ref={listRef}>
        {roomMsgs.length === 0 && <p className="feed-empty">No messages in this room</p>}
        {roomMsgs.map(m => {
          const sender = agents.find(a => a.id === m.fromAgentId)
          return (
            <div key={m.id} className="chat-msg">
              <strong className="chat-sender">{sender?.name ?? m.fromAgentId}</strong>
              <span className="chat-text">{m.message}</span>
              <span className="chat-time">{safeTime(m.createdAt)}</span>
            </div>
          )
        })}
      </div>
      {agents.length > 0 && (
        <form className="chat-form" onSubmit={handleSubmit}>
          <select name="fromAgent" className="assign-select chat-agent-select">
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input name="message" placeholder="Type a message..." className="assign-input chat-input" autoComplete="off" />
          <button type="submit" className="assign-submit chat-send">Send</button>
        </form>
      )}
    </div>
  )
}

// ── Task History with analytics ──────────────────────
function TaskHistoryPanel({ assignments, agents }: {
  assignments: Array<{ id: string; targetAgentId: string; taskTitle: string; status: string; priority: string; createdAt: string; completedAt?: string; durationMs?: number; result?: string }>
  agents: OfficeAgent[]
}) {
  const [filterAgent, setFilterAgent] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const filtered = assignments.filter(a => {
    if (filterAgent && a.targetAgentId !== filterAgent) return false
    if (filterStatus && a.status !== filterStatus) return false
    return true
  })

  // Stats
  const done = assignments.filter(a => a.status === 'done')
  const avgDuration = done.length > 0
    ? Math.round(done.reduce((s, a) => s + (a.durationMs || 0), 0) / done.length / 1000)
    : 0

  // Tasks per agent for bar chart
  const agentCounts: Record<string, number> = {}
  for (const a of done) {
    agentCounts[a.targetAgentId] = (agentCounts[a.targetAgentId] || 0) + 1
  }
  const maxCount = Math.max(1, ...Object.values(agentCounts))

  function exportData() {
    const csv = ['id,agent,title,status,priority,created,completed']
    for (const a of filtered) {
      csv.push(`${a.id},${a.targetAgentId},"${a.taskTitle}",${a.status},${a.priority},${a.createdAt},${a.completedAt || ''}`)
    }
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'task-history.csv'; link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="history-panel">
      <div className="history-stats">
        <div className="stat-card"><span className="stat-value">{done.length}</span><span className="stat-label">Completed</span></div>
        <div className="stat-card"><span className="stat-value">{avgDuration}s</span><span className="stat-label">Avg time</span></div>
        <div className="stat-card"><span className="stat-value">{assignments.filter(a => a.status === 'blocked').length}</span><span className="stat-label">Blocked</span></div>
      </div>
      {Object.keys(agentCounts).length > 0 && (
        <div className="history-chart">
          {Object.entries(agentCounts).map(([agentId, count]) => {
            const agent = agents.find(a => a.id === agentId)
            return (
              <div key={agentId} className="chart-bar-row">
                <span className="chart-label">{agent?.name ?? agentId}</span>
                <div className="chart-bar" style={{ width: `${(count / maxCount) * 100}%` }} />
                <span className="chart-value">{count}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="history-filters">
        <select className="assign-select" value={filterAgent} onChange={e => setFilterAgent(e.target.value)}>
          <option value="">All agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="assign-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="done">Done</option>
          <option value="blocked">Blocked</option>
          <option value="active">Active</option>
          <option value="queued">Queued</option>
        </select>
        <button className="agent-edit-btn" onClick={exportData}>Export CSV</button>
      </div>
      {filtered.length === 0 && <p className="feed-empty">No matching tasks</p>}
      {filtered.slice(0, 50).map(a => {
        const agent = agents.find(ag => ag.id === a.targetAgentId)
        return (
          <div key={a.id} className={`task-card task-${a.priority} ${a.status === 'done' ? 'task-done' : ''}`}>
            <div className="task-head"><strong>{a.taskTitle}</strong><span className="task-priority">{a.priority}</span></div>
            <div className="task-meta">
              <span>{agent?.name ?? a.targetAgentId}</span>
              <span>{a.status}</span>
              {a.completedAt && <span>{relativeTime(a.completedAt)}</span>}
              {a.durationMs && <span>{Math.round(a.durationMs / 1000)}s</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const OFFICE_MAP = '/assets/pixelart/office-map.png'
const MAP_NATIVE_W = 640
const MAP_NATIVE_H = 800

const presenceLabels: Record<PresenceState, string> = {
  off_hours: 'Off hours',
  available: 'Available',
  active: 'Active',
  in_meeting: 'In meeting',
  paused: 'Paused',
  blocked: 'Blocked'
}

const presenceIcons: Record<PresenceState, string> = {
  off_hours: '\u263E',
  available: '\u25CF',
  active: '\u25B6',
  in_meeting: '\u25A0',
  paused: '\u2016',
  blocked: '\u2715',
}

const activityIcons: Record<string, string> = {
  assignment: '\u25B6',
  presence: '\u25CF',
  decision: '\u2605',
  system: '\u2699'
}

// ── Sprite animation hook ────────────────────────────
function useSpriteFrame(frameCount: number, fps: number = 6): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (frameCount <= 1) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % frameCount)
    }, 1000 / fps)
    return () => clearInterval(interval)
  }, [frameCount, fps])
  return frameCount <= 1 ? 0 : frame
}

// ── Safe date formatting ─────────────────────────────
function safeTime(raw: string): string {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// ── Relative time (e.g. "2m ago") ────────────────────
function relativeTime(raw: string): string {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return 'just now'
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Truncate text for speech bubble ──────────────────
function truncate(text: string, max: number) {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text
}

// ── Speech bubble ────────────────────────────────────
function SpeechBubble({ text, color }: { text: string; color: string }) {
  return (
    <div className="speech-bubble" style={{ ['--bubble-accent' as string]: color }}>
      <div className="speech-text">{truncate(text, 60)}</div>
      <div className="speech-tail" />
    </div>
  )
}

// ── Agent sprite on the map ──────────────────────────
function AgentSprite({ agent, presenceColors, onClick, selected, hovered, onHover, onDragStart, isDragTarget }: {
  agent: OfficeAgent
  presenceColors: Record<PresenceState, string>
  onClick: () => void
  selected: boolean
  hovered: boolean
  onHover: (hovering: boolean) => void
  onDragStart?: (e: React.PointerEvent) => void
  isDragTarget?: boolean
}) {
  const { rooms, agentSeats } = useOffice()
  const [spriteFailed, setSpriteFailed] = useState(false)
  const room = rooms.find(r => r.id === agent.roomId)
  const seat = agentSeats[agent.id]

  const spriteSet = characterSprites[agent.id]
  const spriteUrl = spriteSet ? getCharacterSprite(spriteSet, agent.effectivePresence) : null
  const animData = spriteUrl ? getSpriteAnimData(spriteUrl) : null
  const animated = animData ? animData.frameCount > 1 : false
  const frame = useSpriteFrame(animated ? animData!.frameCount : 1, 5)
  const color = presenceColors[agent.effectivePresence]
  const isIdle = agent.effectivePresence === 'off_hours' || agent.effectivePresence === 'paused'
  const showBubble = selected || hovered

  if (!room || !seat) return null

  return (
    <div
      className={`agent-sprite ${selected ? 'selected' : ''} ${isIdle ? 'idle' : ''} ${isDragTarget ? 'dragging-agent' : ''}`}
      style={{
        left: `${room.zone.x + seat.xPct * room.zone.w / 100}%`,
        top: `${room.zone.y + seat.yPct * room.zone.h / 100}%`,
        ['--accent' as string]: color,
        ['--label-offset-y' as string]: `${spriteSet?.labelOffsetY ?? 34}px`
      }}
      role="button"
      tabIndex={0}
      aria-label={`${agent.name}, ${presenceLabels[agent.effectivePresence]}`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onPointerDown={onDragStart}
    >
      {showBubble && (
        <div aria-hidden="true">
          <SpeechBubble text={agent.focus} color={color} />
        </div>
      )}
      <div className="sprite-shadow" />
      {spriteUrl && spriteSet && animData && !spriteFailed ? (
        animData.frameCount > 1 ? (
          <AnimatedSpriteImg spriteSet={spriteSet} animData={animData} spriteUrl={spriteUrl} frame={frame} onError={() => setSpriteFailed(true)} />
        ) : (
          <img
            src={spriteUrl}
            alt={agent.name}
            className="sprite-art"
            style={{
              width: animData.frameWidth * spriteSet.scale,
              height: animData.frameHeight * spriteSet.scale,
              transform: 'translate(-50%, -100%)'
            }}
            draggable={false}
            onError={() => setSpriteFailed(true)}
          />
        )
      ) : (
        <div className="sprite-dot" style={{ background: color, boxShadow: `0 0 8px ${color}88` }}>
          <span className="sprite-initial">{agent.name[0]}</span>
        </div>
      )}
      <div className={`sprite-badge presence-${agent.effectivePresence}`} style={{ background: color }} />
      <div className="sprite-label">{agent.name}</div>
      {(agent.effectivePresence === 'active' || agent.effectivePresence === 'in_meeting') && (
        <div className="sprite-pulse" style={{ borderColor: color }} />
      )}
    </div>
  )
}

// ── Animated sprite strip renderer ───────────────────
function AnimatedSpriteImg({ spriteSet, animData, spriteUrl, frame, onError }: {
  spriteSet: CharacterSpriteSet
  animData: SpriteAnimData
  spriteUrl: string
  frame: number
  onError?: () => void
}) {
  const { frameWidth, frameHeight } = animData
  const { scale } = spriteSet
  const w = frameWidth * scale
  const h = frameHeight * scale
  return (
    <div
      className="sprite-frame-clip"
      style={{
        width: w,
        height: h,
        position: 'absolute',
        left: '50%',
        bottom: 8,
        transform: 'translateX(-50%)',
        overflow: 'hidden'
      }}
    >
      <img
        src={spriteUrl}
        alt=""
        className="sprite-art-strip"
        style={{
          height: h,
          width: 'auto',
          imageRendering: 'pixelated',
          marginLeft: -(frame * w),
          pointerEvents: 'none'
        }}
        draggable={false}
        onError={onError}
      />
    </div>
  )
}

// ── Room overlay (clickable) ─────────────────────────
function RoomOverlay({ room, highlight, agentCount, onClick }: {
  room: Room
  highlight: boolean
  agentCount: number
  onClick: () => void
}) {
  return (
    <div
      className={`room-overlay ${highlight ? 'highlight' : ''}`}
      style={{
        left: `${room.zone.x}%`,
        top: `${room.zone.y}%`,
        width: `${room.zone.w}%`,
        height: `${room.zone.h}%`
      }}
      role="button"
      tabIndex={0}
      aria-label={`${room.name}, ${agentCount} agent${agentCount !== 1 ? 's' : ''}`}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <span className="room-label">{room.name}</span>
      {agentCount > 0 && <span className="room-count">{agentCount}</span>}
    </div>
  )
}

// ── Room detail card (sidebar) ───────────────────────
function RoomDetailCard({ room, agents, presenceColors, onClose }: {
  room: Room
  agents: OfficeAgent[]
  presenceColors: Record<PresenceState, string>
  onClose: () => void
}) {
  const roomAgents = agents.filter(a => a.roomId === room.id)
  return (
    <div className="room-detail-card">
      <div className="room-detail-head">
        <div>
          <h3>{room.name}</h3>
          <span className="room-detail-team">{room.team}</span>
        </div>
        <button className="assign-close" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <p className="room-detail-purpose">{room.purpose}</p>
      {roomAgents.length > 0 ? (
        <div className="room-detail-agents">
          {roomAgents.map(a => (
            <div key={a.id} className="room-agent-row">
              <span className="roster-dot" aria-hidden="true" style={{ background: presenceColors[a.effectivePresence] }}>{presenceIcons[a.effectivePresence]}</span>
              <span>{a.name}</span>
              <span className="roster-state" style={{ color: presenceColors[a.effectivePresence] }}>
                {presenceLabels[a.effectivePresence]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="feed-empty">No agents in this room</p>
      )}
    </div>
  )
}

// ── Complete task form (inline) ──────────────────────
function CompleteTaskForm({ assignmentId, taskTitle, onClose }: { assignmentId: string; taskTitle: string; onClose: () => void }) {
  const { completeTask } = useOffice()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { textareaRef.current?.focus() }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    const result = (fd.get('result') as string)?.trim()
    if (!result) return
    completeTask(assignmentId, result)
    onClose()
  }

  return (
    <form className="complete-form" onSubmit={handleSubmit}>
      <div className="assign-form-head">
        <strong>Complete: {truncate(taskTitle, 30)}</strong>
        <button type="button" className="assign-close" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <label htmlFor={`result-${assignmentId}`} className="visually-hidden">Result</label>
      <textarea ref={textareaRef} id={`result-${assignmentId}`} name="result" placeholder="Enter task result..." rows={3} required aria-required="true" className="assign-input" />
      <button type="submit" className="assign-submit">Submit result</button>
    </form>
  )
}

// ── Task result display ──────────────────────────────
function TaskResultDisplay({ assignment }: { assignment: { id: string; result?: string; resultAction?: string; resultSavedAt?: string } }) {
  const { saveResult, dismissResult } = useOffice()
  if (!assignment.result) return null
  if (assignment.resultAction === 'dismissed') return null

  return (
    <div className="task-result">
      <p className="task-result-text">{assignment.result}</p>
      {assignment.resultAction !== 'saved' ? (
        <div className="task-result-actions">
          <button className="result-save-btn" onClick={() => saveResult(assignment.id)}>Save locally</button>
          <button className="result-dismiss-btn" onClick={() => dismissResult(assignment.id)}>Dismiss</button>
        </div>
      ) : (
        <span className="result-saved-label">Saved {assignment.resultSavedAt ? relativeTime(assignment.resultSavedAt) : ''}</span>
      )}
    </div>
  )
}

// ── Assignment form ──────────────────────────────────
function AssignmentForm({ targetAgentId, onClose }: { targetAgentId: string; onClose: () => void }) {
  const { assignTask, agents } = useOffice()
  const agent = agents.find(a => a.id === targetAgentId)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    assignTask({
      targetAgentId,
      taskTitle: fd.get('title') as string,
      taskBrief: fd.get('brief') as string,
      priority: fd.get('priority') as 'low' | 'medium' | 'high',
      routingTarget: fd.get('routing') as 'agent_runtime' | 'work_tracker' | 'both'
    })
    onClose()
  }

  return (
    <form className="assign-form" onSubmit={handleSubmit}>
      <div className="assign-form-head">
        <strong>Assign to {agent?.name ?? targetAgentId}</strong>
        <button type="button" className="assign-close" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <label htmlFor="assign-title" className="visually-hidden">Task title</label>
      <input ref={titleRef} id="assign-title" name="title" placeholder="Task title" required aria-required="true" className="assign-input" />
      <label htmlFor="assign-brief" className="visually-hidden">Brief description</label>
      <textarea id="assign-brief" name="brief" placeholder="Brief description" rows={2} className="assign-input" />
      <div className="assign-row">
        <div>
          <label htmlFor="assign-priority" className="visually-hidden">Priority</label>
          <select id="assign-priority" name="priority" className="assign-select" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label htmlFor="assign-routing" className="visually-hidden">Routing target</label>
          <select id="assign-routing" name="routing" className="assign-select" defaultValue="agent_runtime">
            <option value="agent_runtime">Agent runtime</option>
            <option value="work_tracker">Work tracker</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>
      <button type="submit" className="assign-submit">Queue assignment</button>
    </form>
  )
}

// ── Agent CRUD form ──────────────────────────────────
function AgentForm({ agent, onClose }: { agent?: OfficeAgent; onClose: () => void }) {
  const { createAgent, updateAgent, rooms } = useOffice()
  const nameRef = useRef<HTMLInputElement>(null)
  const isEdit = !!agent

  useEffect(() => { nameRef.current?.focus() }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    if (isEdit) {
      const input: AgentUpdateInput = {
        name: fd.get('name') as string,
        role: fd.get('role') as string,
        team: fd.get('team') as string,
        roomId: fd.get('roomId') as string,
        presence: fd.get('presence') as PresenceState,
        focus: fd.get('focus') as string,
        criticalTask: fd.get('criticalTask') === 'on',
        collaborationMode: fd.get('collaborationMode') as string,
        systemPrompt: fd.get('systemPrompt') as string,
      }
      await updateAgent(agent.id, input)
    } else {
      const input: AgentCreateInput = {
        id: fd.get('id') as string,
        name: fd.get('name') as string,
        role: fd.get('role') as string,
        team: fd.get('team') as string,
        roomId: fd.get('roomId') as string,
        presence: (fd.get('presence') as PresenceState) || 'available',
        focus: fd.get('focus') as string,
        criticalTask: fd.get('criticalTask') === 'on',
        collaborationMode: fd.get('collaborationMode') as string,
        systemPrompt: fd.get('systemPrompt') as string,
      }
      await createAgent(input)
    }
    onClose()
  }

  return (
    <form className="assign-form agent-form" onSubmit={handleSubmit}>
      <div className="assign-form-head">
        <strong>{isEdit ? `Edit ${agent.name}` : 'Add Agent'}</strong>
        <button type="button" className="assign-close" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      {!isEdit && (
        <>
          <label htmlFor="agent-id" className="visually-hidden">Agent ID</label>
          <input id="agent-id" name="id" placeholder="Agent ID (lowercase, hyphens)" required aria-required="true" pattern="[a-z0-9-]+" className="assign-input" />
        </>
      )}
      <label htmlFor="agent-name" className="visually-hidden">Name</label>
      <input ref={nameRef} id="agent-name" name="name" placeholder="Name" required aria-required="true" defaultValue={agent?.name ?? ''} className="assign-input" />
      <label htmlFor="agent-role" className="visually-hidden">Role</label>
      <input id="agent-role" name="role" placeholder="Role" required aria-required="true" defaultValue={agent?.role ?? ''} className="assign-input" />
      <label htmlFor="agent-team" className="visually-hidden">Team</label>
      <input id="agent-team" name="team" placeholder="Team" required aria-required="true" defaultValue={agent?.team ?? ''} className="assign-input" />
      <div className="assign-row">
        <div>
          <label htmlFor="agent-room" className="visually-hidden">Room</label>
          <select id="agent-room" name="roomId" className="assign-select" required aria-required="true" defaultValue={agent?.roomId ?? rooms[0]?.id ?? ''}>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="agent-presence" className="visually-hidden">Presence</label>
          <select id="agent-presence" name="presence" className="assign-select" defaultValue={agent?.effectivePresence ?? 'available'}>
            <option value="available">Available</option>
            <option value="active">Active</option>
            <option value="in_meeting">In meeting</option>
            <option value="paused">Paused</option>
            <option value="blocked">Blocked</option>
            <option value="off_hours">Off hours</option>
          </select>
        </div>
      </div>
      <label htmlFor="agent-focus" className="visually-hidden">Focus</label>
      <input id="agent-focus" name="focus" placeholder="Current focus" defaultValue={agent?.focus ?? ''} className="assign-input" />
      <label htmlFor="agent-collab" className="visually-hidden">Collaboration mode</label>
      <input id="agent-collab" name="collaborationMode" placeholder="Collaboration mode" defaultValue={agent?.collaborationMode ?? ''} className="assign-input" />
      <label className="agent-form-checkbox">
        <input type="checkbox" name="criticalTask" defaultChecked={agent?.criticalTask ?? false} />
        <span>Critical task</span>
      </label>
      <details className="system-prompt-section">
        <summary className="settings-label" style={{ cursor: 'pointer', padding: '4px 0' }}>System prompt (optional)</summary>
        <label htmlFor="agent-prompt" className="visually-hidden">System prompt</label>
        <textarea id="agent-prompt" name="systemPrompt" placeholder="Custom system prompt for this agent..." rows={4} maxLength={5000} defaultValue={agent?.systemPrompt ?? ''} className="assign-input" />
        <div className="prompt-templates">
          <span className="settings-label">Templates:</span>
          <button type="button" className="prompt-template-btn" onClick={e => {
            const ta = (e.target as HTMLElement).closest('details')?.querySelector('textarea')
            if (ta) ta.value = `You are a meticulous code reviewer. Focus on correctness, security, and performance. Flag potential bugs, suggest improvements, and ensure code follows best practices. Be concise but thorough.`
          }}>Code reviewer</button>
          <button type="button" className="prompt-template-btn" onClick={e => {
            const ta = (e.target as HTMLElement).closest('details')?.querySelector('textarea')
            if (ta) ta.value = `You are a technical writer. Write clear, well-structured documentation. Focus on explaining the "why" behind decisions, provide code examples where relevant, and ensure documentation stays actionable and up-to-date.`
          }}>Tech writer</button>
          <button type="button" className="prompt-template-btn" onClick={e => {
            const ta = (e.target as HTMLElement).closest('details')?.querySelector('textarea')
            if (ta) ta.value = `You are a thorough researcher. Investigate topics deeply, cross-reference multiple sources, synthesize findings clearly, and highlight key insights with supporting evidence. Present balanced viewpoints.`
          }}>Researcher</button>
          <button type="button" className="prompt-template-btn" onClick={e => {
            const ta = (e.target as HTMLElement).closest('details')?.querySelector('textarea')
            if (ta) ta.value = `You are a project manager. Break down work into clear tasks, track dependencies, identify blockers early, and communicate status updates concisely. Focus on unblocking the team and maintaining momentum.`
          }}>PM</button>
        </div>
      </details>
      <button type="submit" className="assign-submit">{isEdit ? 'Save changes' : 'Create agent'}</button>
    </form>
  )
}

// ── Main app ─────────────────────────────────────────
export function App() {
  const office = useOffice()
  const { agents, rooms, workdayPolicy, officeSettings, activity, assignments, agentRuntimeStatuses, decisions, messages, webhooks, toasts, selectedAgentId, selectAgent, berlinTimeLabel, withinWorkday, dataSource, connectionError, deleteAgent, createDecision, updateDecision, sendMessage, dismissToast, updateAgentPosition } = office

  const presenceColors: Record<PresenceState, string> = officeSettings.theme?.presenceColors ?? defaultPresenceColors

  const [mapScale, setMapScale] = useState(2)
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [showAgentForm, setShowAgentForm] = useState<'create' | 'edit' | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'roster' | 'activity' | 'tasks' | 'decisions' | 'chat' | 'history' | 'settings'>('roster')
  const [showDecisionForm, setShowDecisionForm] = useState(false)
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [sheetSnap, setSheetSnap] = useState<'collapsed' | 'half' | 'full'>('collapsed')
  const [isDragging, setIsDragging] = useState(false)
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null)
  const dragAgentStart = useRef<{ x: number; y: number; agentXPct: number; agentYPct: number } | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  // Count of done tasks with unhandled results (not saved, not dismissed)
  const pendingResultCount = assignments.filter(a =>
    a.status === 'done' && a.result && a.resultAction !== 'saved' && a.resultAction !== 'dismissed'
  ).length

  const selected = agents.find(a => a.id === selectedAgentId)
  const selectedRoom = selected ? rooms.find(r => r.id === selected.roomId) : null
  const clickedRoom = rooms.find(r => r.id === selectedRoomId)
  const selectedAssignments = selected
    ? assignments.filter(a => a.targetAgentId === selected.id)
    : []
  const selectedActivity = selected
    ? activity.filter(item => item.agentId === selected.id)
    : []
  const selectedLiveFeed = selected
    ? [
        {
          id: `presence-${selected.id}`,
          kind: 'presence' as const,
          text: `${selected.name} is currently ${presenceLabels[selected.effectivePresence].toLowerCase()}`,
          createdAt: new Date().toISOString(),
        },
        {
          id: `focus-${selected.id}`,
          kind: 'system' as const,
          text: `Focus: ${selected.focus}`,
          createdAt: new Date().toISOString(),
        },
        ...selectedAssignments.map(a => ({
          id: `assignment-live-${a.id}`,
          kind: 'assignment' as const,
          text: `${a.status.toUpperCase()} · ${a.taskTitle}${a.taskBrief ? ` — ${a.taskBrief}` : ''}`,
          createdAt: a.createdAt,
        })),
        ...selectedActivity.map(item => ({
          id: `activity-live-${item.id}`,
          kind: item.kind,
          text: item.text,
          createdAt: item.createdAt,
        })),
      ]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 12)
    : []

  const handleZoom = useCallback((dir: 1 | -1) => {
    setMapScale(s => Math.min(4, Math.max(1, s + dir * 0.5)))
  }, [])

  // Escape to deselect, arrow keys to navigate agents
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        selectAgent(null)
        setShowAssignForm(false)
        setShowAgentForm(null)
        setDeleteConfirm(null)
        setSelectedRoomId(null)
        return
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && agents.length > 0) {
        e.preventDefault()
        const idx = agents.findIndex(a => a.id === selectedAgentId)
        const next = e.key === 'ArrowDown'
          ? (idx + 1) % agents.length
          : (idx - 1 + agents.length) % agents.length
        selectAgent(agents[next].id)
        setSelectedRoomId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectAgent, selectedAgentId, agents])

  // Scroll wheel zoom on map
  const mapScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = mapScrollRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setMapScale(s => Math.min(4, Math.max(1, s + (e.deltaY < 0 ? 0.25 : -0.25))))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Bottom sheet drag handling
  const handleDragStart = useCallback((e: React.PointerEvent) => {
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartHeight.current = sheetRef.current?.offsetHeight ?? 0
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging || !sheetRef.current) return
    const delta = dragStartY.current - e.clientY
    const newHeight = Math.max(48, Math.min(window.innerHeight * 0.9, dragStartHeight.current + delta))
    sheetRef.current.style.height = `${newHeight}px`
  }, [isDragging])

  const handleDragEnd = useCallback(() => {
    if (!isDragging || !sheetRef.current) return
    setIsDragging(false)
    const h = sheetRef.current.offsetHeight
    const vh = window.innerHeight
    // Snap to nearest point
    if (h < vh * 0.15) {
      setSheetSnap('collapsed')
    } else if (h < vh * 0.65) {
      setSheetSnap('half')
    } else {
      setSheetSnap('full')
    }
    sheetRef.current.style.height = ''
  }, [isDragging])

  // Auto-open sheet when selecting agent/room
  useEffect(() => {
    if (selectedAgentId || selectedRoomId) {
      if (sheetSnap === 'collapsed') setSheetSnap('half')
    }
  }, [selectedAgentId, selectedRoomId, sheetSnap])

  const mapW = MAP_NATIVE_W * mapScale
  const mapH = MAP_NATIVE_H * mapScale

  // Agent drag-and-drop handlers
  const handleAgentDragStart = useCallback((agentId: string, e: React.PointerEvent) => {
    const seat = office.agentSeats[agentId]
    if (!seat) return
    setDraggingAgentId(agentId)
    dragAgentStart.current = { x: e.clientX, y: e.clientY, agentXPct: seat.xPct, agentYPct: seat.yPct }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [office.agentSeats])

  useEffect(() => {
    if (!draggingAgentId) return
    const mapContainer = mapScrollRef.current?.querySelector('.map-container')
    if (!mapContainer) return

    function onMove(e: PointerEvent) {
      if (!dragAgentStart.current || !draggingAgentId) return
      const rect = mapContainer!.getBoundingClientRect()
      const xPctMap = ((e.clientX - rect.left) / rect.width) * 100
      const yPctMap = ((e.clientY - rect.top) / rect.height) * 100
      // Find which room the cursor is in
      const agent = agents.find(a => a.id === draggingAgentId)
      if (!agent) return
      const room = rooms.find(r => r.id === agent.roomId)
      if (!room) return
      // Convert map pct to room-relative pct
      const relX = Math.max(0, Math.min(100, ((xPctMap - room.zone.x) / room.zone.w) * 100))
      const relY = Math.max(0, Math.min(100, ((yPctMap - room.zone.y) / room.zone.h) * 100))
      // Snap to 10% grid
      const snappedX = Math.round(relX / 10) * 10
      const snappedY = Math.round(relY / 10) * 10
      updateAgentPosition(draggingAgentId, snappedX, snappedY)
    }

    function onUp() {
      // Check if dropped in a different room
      setDraggingAgentId(null)
      dragAgentStart.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [draggingAgentId, agents, rooms, updateAgentPosition])

  function handleRoomClick(roomId: string) {
    selectAgent(null)
    setSelectedRoomId(selectedRoomId === roomId ? null : roomId)
  }

  function handleAgentClick(agentId: string) {
    selectAgent(selectedAgentId === agentId ? null : agentId)
    setSelectedRoomId(null)
    setShowAssignForm(false)
    setShowAgentForm(null)
    setDeleteConfirm(null)
  }

  return (
    <div className="office-world">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* Floating status overlay */}
      <div className="map-status">
        <h1 className="office-title">{officeSettings.officeName || 'Agent Office'}</h1>
        <span className={`office-status ${withinWorkday ? 'on' : 'off'}`}>
          {withinWorkday ? 'Open' : 'Closed'}
        </span>
        <span className={`office-status ${dataSource === 'live' ? 'on' : 'off'}`}>
          {dataSource === 'live' ? 'Live' : 'Seed'}
        </span>
        <span className="berlin-clock">{berlinTimeLabel}</span>
      </div>

      <main id="main-content" className="office-layout">
        {/* Map viewport — fills entire screen */}
        <div className="map-viewport">
          <div className="map-controls">
            <button onClick={() => handleZoom(1)} title="Zoom in" aria-label="Zoom in">+</button>
            <button onClick={() => handleZoom(-1)} title="Zoom out" aria-label="Zoom out">&minus;</button>
            <span className="zoom-label">{mapScale}x</span>
          </div>
          <div className="map-scroll" ref={mapScrollRef}>
            <div className="map-container" style={{ width: mapW, height: mapH }}>
              <img src={OFFICE_MAP} alt="Agent Office pixel-art map" className="map-bg" draggable={false} />
              {rooms.map(room => (
                <RoomOverlay
                  key={room.id}
                  room={room}
                  highlight={selectedRoom?.id === room.id || selectedRoomId === room.id}
                  agentCount={agents.filter(a => a.roomId === room.id).length}
                  onClick={() => handleRoomClick(room.id)}
                />
              ))}
              {agents.map(agent => (
                <AgentSprite
                  key={agent.id}
                  agent={agent}
                  presenceColors={presenceColors}
                  onClick={() => handleAgentClick(agent.id)}
                  selected={selectedAgentId === agent.id}
                  hovered={hoveredAgent === agent.id}
                  onHover={h => setHoveredAgent(h ? agent.id : null)}
                  onDragStart={e => handleAgentDragStart(agent.id, e)}
                  isDragTarget={draggingAgentId === agent.id}
                />
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className={`bottom-sheet snap-${sheetSnap} ${isDragging ? 'dragging' : ''}`}
        role="complementary"
        aria-label="Office controls"
      >
        <div
          className="sheet-handle"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className="sheet-handle-bar" />
        </div>

        <div className="sheet-body">
          {/* Connection error banner */}
          {connectionError && (
            <div className="connection-error" role="alert">
              <span className="connection-error-icon" aria-hidden="true">&#x26A0;</span>
              <span>{connectionError}</span>
            </div>
          )}

          {/* Presence summary */}
          <div className="presence-summary">
            <h2>Presence</h2>
            <div className="presence-grid">
              {(Object.keys(presenceColors) as PresenceState[]).map(state => {
                const count = agents.filter(a => a.effectivePresence === state).length
                if (count === 0) return null
                return (
                  <div key={state} className="presence-row">
                    <span className="presence-dot" aria-hidden="true" style={{ background: presenceColors[state] }}>{presenceIcons[state]}</span>
                    <span className="presence-name">{presenceLabels[state]}</span>
                    <span className="presence-count">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Tab bar */}
          <div className="side-tabs" role="tablist">
            <button className={`side-tab ${sideTab === 'roster' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'roster'} onClick={() => setSideTab('roster')}>Agents</button>
            <button className={`side-tab ${sideTab === 'activity' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'activity'} onClick={() => setSideTab('activity')}>Feed</button>
            <button className={`side-tab ${sideTab === 'tasks' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'tasks'} onClick={() => setSideTab('tasks')}>
              Tasks{assignments.length > 0 ? ` (${assignments.length})` : ''}
              {pendingResultCount > 0 && <span className="result-badge">{pendingResultCount}</span>}
            </button>
            <button className={`side-tab ${sideTab === 'decisions' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'decisions'} onClick={() => setSideTab('decisions')}>
              Decisions{decisions.length > 0 ? ` (${decisions.length})` : ''}
            </button>
            <button className={`side-tab ${sideTab === 'chat' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'chat'} onClick={() => setSideTab('chat')}>Chat</button>
            <button className={`side-tab ${sideTab === 'history' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'history'} onClick={() => setSideTab('history')}>History</button>
            <button className={`side-tab ${sideTab === 'settings' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'settings'} onClick={() => setSideTab('settings')}>Settings</button>
          </div>

          {/* Roster tab */}
          {sideTab === 'roster' && (
            <div className="agent-roster" role="tabpanel">
              <button className="add-agent-btn" onClick={() => { setShowAgentForm('create'); selectAgent(null) }} aria-label="Add agent">+ Add Agent</button>
              {agents.length === 0 && <p className="feed-empty">No agents yet. Add one to get started.</p>}
              {agents.map(agent => {
                const color = presenceColors[agent.effectivePresence]
                const room = rooms.find(r => r.id === agent.roomId)
                return (
                  <button
                    key={agent.id}
                    className={`roster-card ${selectedAgentId === agent.id ? 'active' : ''}`}
                    onClick={() => handleAgentClick(agent.id)}
                  >
                    <div className="roster-head">
                      <span className="roster-dot" aria-hidden="true" style={{ background: color }}>{presenceIcons[agent.effectivePresence]}</span>
                      <strong>{agent.name}</strong>
                      <span className="roster-state" style={{ color }}>{presenceLabels[agent.effectivePresence]}</span>
                    </div>
                    <div className="roster-meta">
                      <span>{agent.role}</span>
                      <span>{room?.name}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Activity feed tab */}
          {sideTab === 'activity' && (
            <div className="activity-feed" role="tabpanel" aria-live="polite">
              {activity.length === 0 && (dataSource === 'seed' ? (
                <>
                  <div className="feed-skeleton" />
                  <div className="feed-skeleton" />
                  <div className="feed-skeleton" />
                </>
              ) : (
                <p className="feed-empty">No activity yet</p>
              ))}
              {activity.map(item => (
                <div key={item.id} className={`feed-entry feed-${item.kind}`}>
                  <span className="feed-icon" aria-hidden="true">{activityIcons[item.kind] ?? '\u25CB'}</span>
                  <div className="feed-body">
                    <span className="feed-text">{item.text}</span>
                    <span className="feed-time">{safeTime(item.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tasks tab */}
          {sideTab === 'tasks' && (
            <div className="tasks-panel" role="tabpanel">
              {assignments.length === 0 && <p className="feed-empty">No queued tasks</p>}
              {assignments.map(a => {
                const agent = agents.find(ag => ag.id === a.targetAgentId)
                return (
                  <div key={a.id} className={`task-card task-${a.priority} ${a.status === 'done' ? 'task-done' : ''}`}>
                    <div className="task-head">
                      <strong>{a.taskTitle}</strong>
                      <span className="task-priority">{a.priority}</span>
                    </div>
                    <div className="task-meta">
                      <span>{agent?.name ?? a.targetAgentId}</span>
                      <span>{a.status}</span>
                      <span>{a.routingTarget.replace('_', ' ')}</span>
                    </div>
                    {a.taskBrief && <p className="task-brief">{a.taskBrief}</p>}
                    {a.status === 'active' && completingTaskId !== a.id && (
                      <button className="complete-task-btn" onClick={() => setCompletingTaskId(a.id)}>Complete</button>
                    )}
                    {completingTaskId === a.id && (
                      <CompleteTaskForm assignmentId={a.id} taskTitle={a.taskTitle} onClose={() => setCompletingTaskId(null)} />
                    )}
                    {a.status === 'done' && <TaskResultDisplay assignment={a} />}
                  </div>
                )
              })}
            </div>
          )}

          {/* Decisions tab */}
          {sideTab === 'decisions' && (
            <div className="decisions-panel" role="tabpanel">
              <button className="add-agent-btn" onClick={() => setShowDecisionForm(true)}>+ New Decision</button>
              {showDecisionForm && <DecisionForm agents={agents} onSubmit={createDecision} onClose={() => setShowDecisionForm(false)} />}
              {decisions.length === 0 && !showDecisionForm && <p className="feed-empty">No decisions yet</p>}
              {decisions.map(d => (
                <DecisionCard key={d.id} decision={d} agents={agents} onUpdate={updateDecision} />
              ))}
            </div>
          )}

          {/* Chat tab */}
          {sideTab === 'chat' && (
            <ChatPanel messages={messages} agents={agents} rooms={rooms} currentRoomId={selectedRoomId} onSend={sendMessage} />
          )}

          {/* History tab */}
          {sideTab === 'history' && (
            <TaskHistoryPanel assignments={assignments} agents={agents} />
          )}

          {/* Settings tab */}
          {sideTab === 'settings' && <SettingsPanel />}

          {/* Room detail card */}
          {clickedRoom && !selected && (
            <RoomDetailCard room={clickedRoom} agents={agents} presenceColors={presenceColors} onClose={() => setSelectedRoomId(null)} />
          )}

          {/* Agent detail card */}
          {selected && (
            <div className="detail-card" style={{ borderColor: `${presenceColors[selected.effectivePresence]}44` }}>
              <div className="detail-head">
                <div className="detail-avatar" style={{ background: `${presenceColors[selected.effectivePresence]}22`, borderColor: `${presenceColors[selected.effectivePresence]}66` }}>
                  {characterSprites[selected.id] ? (
                    <img
                      src={characterSprites[selected.id].portrait ?? characterSprites[selected.id].idle}
                      alt={selected.name}
                      className="detail-avatar-art"
                      draggable={false}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <span className="detail-avatar-letter">{selected.name[0]}</span>
                  )}
                </div>
                <div>
                  <h3>{selected.name}</h3>
                  <span style={{ color: presenceColors[selected.effectivePresence] }}>
                    {presenceLabels[selected.effectivePresence]}
                  </span>
                </div>
              </div>
              <dl className="detail-fields">
                <dt>Role</dt><dd>{selected.role}</dd>
                <dt>Team</dt><dd>{selected.team}</dd>
                <dt>Room</dt><dd>{selectedRoom?.name}</dd>
                <dt>Focus</dt><dd>{selected.focus}</dd>
                <dt>Mode</dt><dd>{selected.collaborationMode}</dd>
                <dt>Priority</dt><dd>{selected.criticalTask ? 'Critical' : 'Non-critical'}</dd>
                {selected.systemPrompt && (
                  <>
                    <dt>Prompt</dt>
                    <dd><details className="prompt-preview"><summary>View system prompt</summary><pre className="prompt-text">{selected.systemPrompt}</pre></details></dd>
                  </>
                )}
                <dt>Runtime</dt>
                <dd>
                  {(() => {
                    const rs = agentRuntimeStatuses.find(s => s.agentId === selected.id)
                    if (!rs) return <span style={{ color: '#888' }}>Offline</span>
                    if (rs.busy) return <span style={{ color: '#4a9eff' }}>Working...</span>
                    return <span style={{ color: '#4ade80' }}>Connected</span>
                  })()}
                </dd>
              </dl>
              <div className="agent-livefeed">
                <div className="agent-livefeed-head">
                  <strong>Live output</strong>
                  <span>{selectedLiveFeed.length} events</span>
                </div>
                <div className="agent-livefeed-status">
                  <span className="live-pill" style={{ color: presenceColors[selected.effectivePresence], borderColor: `${presenceColors[selected.effectivePresence]}66` }}>
                    {presenceLabels[selected.effectivePresence]}
                  </span>
                  <span className="live-meta">{selectedAssignments.length > 0 ? `${selectedAssignments.length} task(s)` : 'No active task queue'}</span>
                </div>
                <div className="agent-livefeed-list">
                  {selectedLiveFeed.length === 0 ? (
                    <p className="feed-empty">No agent output yet</p>
                  ) : (
                    selectedLiveFeed.map(item => (
                      <div key={item.id} className={`feed-entry livefeed-entry feed-${item.kind}`}>
                        <span className="feed-icon">{activityIcons[item.kind] ?? '\u25CB'}</span>
                        <div className="feed-body">
                          <span className="feed-text">{item.text}</span>
                          <span className="feed-time">{safeTime(item.createdAt)} · {relativeTime(item.createdAt)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {/* Active/Done tasks for this agent */}
              {selectedAssignments.filter(a => a.status === 'active' || a.status === 'done').length > 0 && (
                <div className="agent-tasks-section">
                  {selectedAssignments.filter(a => a.status === 'active').map(a => (
                    <div key={a.id} className="task-card task-inline">
                      <div className="task-head"><strong>{a.taskTitle}</strong><span className="task-priority">{a.priority}</span></div>
                      {completingTaskId === a.id ? (
                        <CompleteTaskForm assignmentId={a.id} taskTitle={a.taskTitle} onClose={() => setCompletingTaskId(null)} />
                      ) : (
                        <button className="complete-task-btn" onClick={() => setCompletingTaskId(a.id)}>Complete</button>
                      )}
                    </div>
                  ))}
                  {selectedAssignments.filter(a => a.status === 'done' && a.result).map(a => (
                    <div key={a.id} className="task-card task-done task-inline">
                      <div className="task-head"><strong>{a.taskTitle}</strong><span className="task-priority">done</span></div>
                      <TaskResultDisplay assignment={a} />
                    </div>
                  ))}
                </div>
              )}
              {showAgentForm === 'edit' ? (
                <AgentForm agent={selected} onClose={() => setShowAgentForm(null)} />
              ) : showAssignForm ? (
                <AssignmentForm targetAgentId={selected.id} onClose={() => setShowAssignForm(false)} />
              ) : (
                <div className="agent-actions">
                  <button className="assign-btn" onClick={() => setShowAssignForm(true)}>
                    Assign task
                  </button>
                  <div className="agent-crud-row">
                    <button className="agent-edit-btn" onClick={() => setShowAgentForm('edit')}>Edit</button>
                    {deleteConfirm === selected.id ? (
                      <div className="delete-confirm">
                        <span>Delete?</span>
                        <button className="delete-yes" onClick={() => { deleteAgent(selected.id); setDeleteConfirm(null) }}>Yes</button>
                        <button className="delete-no" onClick={() => setDeleteConfirm(null)}>No</button>
                      </div>
                    ) : (
                      <button className="agent-delete-btn" onClick={() => setDeleteConfirm(selected.id)}>Delete</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Agent create form (no agent selected) */}
          {showAgentForm === 'create' && !selected && (
            <AgentForm onClose={() => setShowAgentForm(null)} />
          )}

        </div>
      </div>

      {agents.length === 0 && dataSource !== 'seed' && <WelcomeOnboarding />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
