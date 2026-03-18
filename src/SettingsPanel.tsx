import { useState, type FormEvent } from 'react'
import { type PresenceState } from './data'
import { defaultSettings, defaultPresenceColors } from './data'
import { useOffice } from './office-provider'

const presenceLabels: Record<PresenceState, string> = {
  off_hours: 'Off hours',
  available: 'Available',
  active: 'Active',
  in_meeting: 'In meeting',
  paused: 'Paused',
  blocked: 'Blocked'
}

export function SettingsPanel() {
  const { officeSettings, workdayPolicy, rooms, updateSettings, updateRoom, deleteAgent, agents } = useOffice()

  return (
    <div className="settings-panel" role="tabpanel">
      <GeneralSection officeName={officeSettings.officeName} onSave={updateSettings} />
      <WorkdaySection policy={workdayPolicy} onSave={updateSettings} />
      <RoomsSection rooms={rooms} onSave={updateRoom} />
      <ThemeSection colors={officeSettings.theme.presenceColors} onSave={updateSettings} />
      <DangerSection
        onReset={async () => {
          await updateSettings({
            officeName: defaultSettings.officeName,
            theme: { presenceColors: { ...defaultPresenceColors } }
          })
        }}
        onDeleteAll={async () => {
          for (const agent of agents) {
            await deleteAgent(agent.id)
          }
        }}
        agentCount={agents.length}
      />
    </div>
  )
}

function GeneralSection({ officeName, onSave }: {
  officeName: string
  onSave: (patch: { officeName: string }) => Promise<boolean>
}) {
  const [name, setName] = useState(officeName)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({ officeName: name })
    setSaving(false)
  }

  return (
    <details className="settings-section" open>
      <summary>General</summary>
      <form className="settings-section-body" onSubmit={handleSubmit}>
        <label className="settings-label" htmlFor="settings-office-name">Office name</label>
        <input
          id="settings-office-name"
          className="assign-input"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
        />
        <button type="submit" className="assign-submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </details>
  )
}

function WorkdaySection({ policy, onSave }: {
  policy: { timezone: string; days: string; hours: string; pauseRule: string; sharedPlaceRule: string }
  onSave: (patch: { workdayPolicy: Record<string, string> }) => Promise<boolean>
}) {
  const [tz, setTz] = useState(policy.timezone)
  const [days, setDays] = useState(policy.days)
  const [hours, setHours] = useState(policy.hours)
  const [pauseRule, setPauseRule] = useState(policy.pauseRule)
  const [sharedRule, setSharedRule] = useState(policy.sharedPlaceRule)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({
      workdayPolicy: { timezone: tz, days, hours, pauseRule, sharedPlaceRule: sharedRule }
    })
    setSaving(false)
  }

  return (
    <details className="settings-section">
      <summary>Workday Policy</summary>
      <form className="settings-section-body" onSubmit={handleSubmit}>
        <label className="settings-label" htmlFor="settings-tz">Timezone</label>
        <input id="settings-tz" className="assign-input" value={tz} onChange={e => setTz(e.target.value)} />

        <label className="settings-label" htmlFor="settings-days">Office days</label>
        <input id="settings-days" className="assign-input" value={days} onChange={e => setDays(e.target.value)} />

        <label className="settings-label" htmlFor="settings-hours">Office hours</label>
        <input id="settings-hours" className="assign-input" value={hours} onChange={e => setHours(e.target.value)} />

        <label className="settings-label" htmlFor="settings-pause">Pause rule</label>
        <textarea id="settings-pause" className="assign-input" rows={2} value={pauseRule} onChange={e => setPauseRule(e.target.value)} />

        <label className="settings-label" htmlFor="settings-shared">Shared place rule</label>
        <textarea id="settings-shared" className="assign-input" rows={2} value={sharedRule} onChange={e => setSharedRule(e.target.value)} />

        <button type="submit" className="assign-submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </details>
  )
}

function RoomsSection({ rooms, onSave }: {
  rooms: Array<{ id: string; name: string; team: string; purpose: string }>
  onSave: (id: string, input: { name?: string; team?: string; purpose?: string }) => Promise<boolean>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <details className="settings-section">
      <summary>Rooms</summary>
      <div className="settings-section-body">
        {rooms.map(room => (
          <div key={room.id} className="room-edit-card">
            <div className="room-edit-head">
              <span className="room-edit-name">{room.name}</span>
              <button
                type="button"
                className="agent-edit-btn"
                style={{ flex: 'none', padding: '4px 8px' }}
                onClick={() => setEditingId(editingId === room.id ? null : room.id)}
              >
                {editingId === room.id ? 'Cancel' : 'Edit'}
              </button>
            </div>
            <span className="room-edit-team">{room.team}</span>
            {editingId === room.id && (
              <RoomEditForm room={room} onSave={async (input) => {
                const ok = await onSave(room.id, input)
                if (ok) setEditingId(null)
                return ok
              }} />
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

function RoomEditForm({ room, onSave }: {
  room: { name: string; team: string; purpose: string }
  onSave: (input: { name: string; team: string; purpose: string }) => Promise<boolean>
}) {
  const [name, setName] = useState(room.name)
  const [team, setTeam] = useState(room.team)
  const [purpose, setPurpose] = useState(room.purpose)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({ name, team, purpose })
    setSaving(false)
  }

  return (
    <form className="settings-section-body" style={{ marginTop: 8 }} onSubmit={handleSubmit}>
      <label className="settings-label" htmlFor={`room-name-${room.name}`}>Name</label>
      <input id={`room-name-${room.name}`} className="assign-input" value={name} onChange={e => setName(e.target.value)} />

      <label className="settings-label" htmlFor={`room-team-${room.name}`}>Team</label>
      <input id={`room-team-${room.name}`} className="assign-input" value={team} onChange={e => setTeam(e.target.value)} />

      <label className="settings-label" htmlFor={`room-purpose-${room.name}`}>Purpose</label>
      <textarea id={`room-purpose-${room.name}`} className="assign-input" rows={2} value={purpose} onChange={e => setPurpose(e.target.value)} />

      <button type="submit" className="assign-submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save room'}
      </button>
    </form>
  )
}

function ThemeSection({ colors, onSave }: {
  colors: Record<PresenceState, string>
  onSave: (patch: { theme: { presenceColors: Record<string, string> } }) => Promise<boolean>
}) {
  const [localColors, setLocalColors] = useState(colors)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    await onSave({ theme: { presenceColors: localColors } })
    setSaving(false)
  }

  return (
    <details className="settings-section">
      <summary>Theme</summary>
      <form className="settings-section-body" onSubmit={handleSubmit}>
        {(Object.keys(presenceLabels) as PresenceState[]).map(state => (
          <div key={state} className="settings-color-row">
            <input
              type="color"
              className="settings-color-input"
              value={localColors[state]}
              onChange={e => setLocalColors(prev => ({ ...prev, [state]: e.target.value }))}
              aria-label={`Color for ${presenceLabels[state]}`}
            />
            <span className="settings-color-label">{presenceLabels[state]}</span>
            <span className="settings-color-hex">{localColors[state]}</span>
          </div>
        ))}
        <button type="submit" className="assign-submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save colors'}
        </button>
      </form>
    </details>
  )
}

function DangerSection({ onReset, onDeleteAll, agentCount }: {
  onReset: () => Promise<void>
  onDeleteAll: () => Promise<void>
  agentCount: number
}) {
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <details className="settings-section">
      <summary>Danger Zone</summary>
      <div className="settings-section-body danger-zone">
        {confirmReset ? (
          <div className="delete-confirm" style={{ marginBottom: 8 }}>
            <span>Reset all settings?</span>
            <button className="delete-yes" disabled={busy} onClick={async () => {
              setBusy(true)
              await onReset()
              setConfirmReset(false)
              setBusy(false)
            }}>Yes</button>
            <button className="delete-no" onClick={() => setConfirmReset(false)}>No</button>
          </div>
        ) : (
          <button type="button" className="agent-delete-btn" style={{ width: '100%' }} onClick={() => setConfirmReset(true)}>
            Reset all settings to defaults
          </button>
        )}

        {agentCount > 0 && (
          confirmDelete ? (
            <div className="delete-confirm" style={{ marginTop: 8 }}>
              <span>Delete all {agentCount} agents?</span>
              <button className="delete-yes" disabled={busy} onClick={async () => {
                setBusy(true)
                await onDeleteAll()
                setConfirmDelete(false)
                setBusy(false)
              }}>Yes</button>
              <button className="delete-no" onClick={() => setConfirmDelete(false)}>No</button>
            </div>
          ) : (
            <button type="button" className="agent-delete-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setConfirmDelete(true)}>
              Delete all agents ({agentCount})
            </button>
          )
        )}
      </div>
    </details>
  )
}
