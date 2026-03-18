import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { type PresenceState } from './data'
import { useOffice, type AgentCreateInput } from './office-provider'

export function WelcomeOnboarding() {
  const { createAgent, rooms } = useOffice()
  const nameRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  // Focus trap: keep Tab/Shift+Tab inside the dialog
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const focusable = overlay!.querySelectorAll<HTMLElement>(
        'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    overlay.addEventListener('keydown', handleKeyDown)
    return () => overlay.removeEventListener('keydown', handleKeyDown)
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
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

  return (
    <div ref={overlayRef} className="welcome-overlay" role="dialog" aria-label="Welcome to Agent Office">
      <div className="welcome-card">
        <h2 className="welcome-title">Welcome to Agent Office</h2>
        <p className="welcome-subtitle">Your office is empty. Create your first agent to get started.</p>
        <form className="assign-form agent-form" onSubmit={handleSubmit}>
          <label htmlFor="welcome-agent-id" className="visually-hidden">Agent ID</label>
          <input id="welcome-agent-id" name="id" placeholder="Agent ID (lowercase, hyphens)" required aria-required="true" pattern="[a-z0-9-]+" className="assign-input" />
          <label htmlFor="welcome-agent-name" className="visually-hidden">Name</label>
          <input ref={nameRef} id="welcome-agent-name" name="name" placeholder="Name" required aria-required="true" className="assign-input" />
          <label htmlFor="welcome-agent-role" className="visually-hidden">Role</label>
          <input id="welcome-agent-role" name="role" placeholder="Role" required aria-required="true" className="assign-input" />
          <label htmlFor="welcome-agent-team" className="visually-hidden">Team</label>
          <input id="welcome-agent-team" name="team" placeholder="Team" required aria-required="true" className="assign-input" />
          <div className="assign-row">
            <div>
              <label htmlFor="welcome-agent-room" className="visually-hidden">Room</label>
              <select id="welcome-agent-room" name="roomId" className="assign-select" required aria-required="true" defaultValue={rooms[0]?.id ?? ''}>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="welcome-agent-presence" className="visually-hidden">Presence</label>
              <select id="welcome-agent-presence" name="presence" className="assign-select" defaultValue="available">
                <option value="available">Available</option>
                <option value="active">Active</option>
                <option value="in_meeting">In meeting</option>
                <option value="paused">Paused</option>
                <option value="blocked">Blocked</option>
                <option value="off_hours">Off hours</option>
              </select>
            </div>
          </div>
          <label htmlFor="welcome-agent-focus" className="visually-hidden">Focus</label>
          <input id="welcome-agent-focus" name="focus" placeholder="Current focus" className="assign-input" />
          <label htmlFor="welcome-agent-collab" className="visually-hidden">Collaboration mode</label>
          <input id="welcome-agent-collab" name="collaborationMode" placeholder="Collaboration mode" className="assign-input" />
          <label className="agent-form-checkbox">
            <input type="checkbox" name="criticalTask" />
            <span>Critical task</span>
          </label>
          <button type="submit" className="assign-submit">Create agent</button>
        </form>
      </div>
    </div>
  )
}
