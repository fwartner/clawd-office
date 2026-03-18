import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { type PresenceState, type Room } from './data'
import { useOffice, type OfficeAgent, type AgentCreateInput, type AgentUpdateInput } from './office-provider'
import { characterSprites, getCharacterSprite, getSpriteAnimData, type CharacterSpriteSet, type SpriteAnimData } from './world'

const OFFICE_MAP = '/assets/pixelart/Office Tileset/Office Designs/Office Level 4.png'
const MAP_NATIVE_W = 640
const MAP_NATIVE_H = 800

const presenceColors: Record<PresenceState, string> = {
  off_hours: '#8792a8',
  available: '#95d8ff',
  active: '#78f7b5',
  in_meeting: '#c39bff',
  paused: '#ffd479',
  blocked: '#ff8b8b'
}

const presenceLabels: Record<PresenceState, string> = {
  off_hours: 'Off hours',
  available: 'Available',
  active: 'Active',
  in_meeting: 'In meeting',
  paused: 'Paused',
  blocked: 'Blocked'
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
function AgentSprite({ agent, onClick, selected, hovered, onHover }: {
  agent: OfficeAgent
  onClick: () => void
  selected: boolean
  hovered: boolean
  onHover: (hovering: boolean) => void
}) {
  const { rooms, agentSeats } = useOffice()
  const [spriteFailed, setSpriteFailed] = useState(false)
  const room = rooms.find(r => r.id === agent.roomId)
  const seat = agentSeats[agent.id]
  if (!room || !seat) return null

  const spriteSet = characterSprites[agent.id]
  const spriteUrl = spriteSet ? getCharacterSprite(spriteSet, agent.effectivePresence) : null
  const animData = spriteUrl ? getSpriteAnimData(spriteUrl) : null
  const animated = animData ? animData.frameCount > 1 : false
  const frame = useSpriteFrame(animated ? animData!.frameCount : 1, 5)
  const color = presenceColors[agent.effectivePresence]
  const isIdle = agent.effectivePresence === 'off_hours' || agent.effectivePresence === 'paused'
  const showBubble = selected || hovered

  return (
    <div
      className={`agent-sprite ${selected ? 'selected' : ''} ${isIdle ? 'idle' : ''}`}
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
    >
      {showBubble && (
        <SpeechBubble text={agent.focus} color={color} />
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
      <div className="sprite-badge" style={{ background: color }} />
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
function RoomDetailCard({ room, agents, onClose }: {
  room: Room
  agents: OfficeAgent[]
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
              <span className="roster-dot" style={{ background: presenceColors[a.effectivePresence] }} />
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
      <button type="submit" className="assign-submit">{isEdit ? 'Save changes' : 'Create agent'}</button>
    </form>
  )
}

// ── Main app ─────────────────────────────────────────
export function App() {
  const office = useOffice()
  const { agents, rooms, workdayPolicy, activity, assignments, selectedAgentId, selectAgent, berlinTimeLabel, withinWorkday, dataSource, connectionError, deleteAgent } = office

  const [mapScale, setMapScale] = useState(2)
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [showAgentForm, setShowAgentForm] = useState<'create' | 'edit' | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'roster' | 'activity' | 'tasks'>('roster')
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)

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

  const mapW = MAP_NATIVE_W * mapScale
  const mapH = MAP_NATIVE_H * mapScale

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
      {/* Header */}
      <header className="office-header">
        <div className="header-left">
          <h1 className="office-title">Clawd Office</h1>
          <span className={`office-status ${withinWorkday ? 'on' : 'off'}`}>
            {withinWorkday ? 'Open' : 'Closed'}
          </span>
          <span className={`office-status ${dataSource === 'live' ? 'on' : 'off'}`}>
            {dataSource === 'live' ? 'Live' : 'Seed'}
          </span>
        </div>
        <div className="header-right">
          <span className="berlin-clock">{berlinTimeLabel} Berlin</span>
          <span className="header-policy">{workdayPolicy.days} {workdayPolicy.hours}</span>
        </div>
      </header>

      <main id="main-content" className="office-layout">
        {/* Map viewport */}
        <div className="map-viewport">
          <div className="map-controls">
            <button onClick={() => handleZoom(1)} title="Zoom in" aria-label="Zoom in">+</button>
            <button onClick={() => handleZoom(-1)} title="Zoom out" aria-label="Zoom out">&minus;</button>
            <span className="zoom-label">{mapScale}x</span>
          </div>
          <div className="map-scroll" ref={mapScrollRef}>
            <div className="map-container" style={{ width: mapW, height: mapH }}>
              <img src={OFFICE_MAP} alt="Clawd Office pixel-art map" className="map-bg" draggable={false} />
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
                  onClick={() => handleAgentClick(agent.id)}
                  selected={selectedAgentId === agent.id}
                  hovered={hoveredAgent === agent.id}
                  onHover={h => setHoveredAgent(h ? agent.id : null)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Side panel */}
        <aside className="side-panel">
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
                    <span className="presence-dot" aria-hidden="true" style={{ background: presenceColors[state] }} />
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
            <button className={`side-tab ${sideTab === 'tasks' ? 'active' : ''}`} role="tab" aria-selected={sideTab === 'tasks'} onClick={() => setSideTab('tasks')}>All Tasks{assignments.length > 0 ? ` (${assignments.length})` : ''}</button>
          </div>

          {/* Roster tab */}
          {sideTab === 'roster' && (
            <div className="agent-roster" role="tabpanel">
              <button className="add-agent-btn" onClick={() => { setShowAgentForm('create'); selectAgent(null) }} aria-label="Add agent">+ Add Agent</button>
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
                      <span className="roster-dot" style={{ background: color }} />
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
              {activity.length === 0 && <p className="feed-empty">No activity yet</p>}
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
                  <div key={a.id} className={`task-card task-${a.priority}`}>
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
                  </div>
                )
              })}
            </div>
          )}

          {/* Room detail card */}
          {clickedRoom && !selected && (
            <RoomDetailCard room={clickedRoom} agents={agents} onClose={() => setSelectedRoomId(null)} />
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

          <div className="office-rules">
            <p>{workdayPolicy.pauseRule}</p>
          </div>
        </aside>
      </main>
    </div>
  )
}
