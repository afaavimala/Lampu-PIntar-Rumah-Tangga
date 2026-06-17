import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  createUser,
  getUserAssignments,
  listUsers,
  replaceUserAssignments,
  updateUser,
} from '../lib/api'
import type {
  DevicePermission,
  SchedulePermission,
  UserAssignment,
  UserSummary,
} from '../lib/types'

const DEVICE_PERMISSION_OPTIONS: Array<{ value: DevicePermission; label: string }> = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'control', label: 'Control' },
  { value: 'manage', label: 'Manage' },
]

const SCHEDULE_PERMISSION_OPTIONS: Array<{ value: SchedulePermission; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'manage', label: 'Manage' },
]

type AssignmentDraft = UserAssignment

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function canUseScheduleManage(devicePermission: DevicePermission) {
  return devicePermission === 'control' || devicePermission === 'manage'
}

export function UserManager() {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([])
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newActive, setNewActive] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const members = useMemo(() => users.filter((user) => user.role === 'member'), [users])
  const selectedUser = useMemo(
    () => members.find((user) => user.id === selectedUserId) ?? null,
    [members, selectedUserId],
  )

  const loadUsers = useCallback(async (preferredUserId?: number | null) => {
    setLoadingUsers(true)
    setError(null)
    try {
      const nextUsers = await listUsers()
      const nextMembers = nextUsers.filter((user) => user.role === 'member')
      setUsers(nextUsers)

      const resolvedSelection =
        preferredUserId != null && nextMembers.some((user) => user.id === preferredUserId)
          ? preferredUserId
          : nextMembers[0]?.id ?? null
      setSelectedUserId(resolvedSelection)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal memuat user'))
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  const loadAssignments = useCallback(async (userId: number) => {
    setLoadingAssignments(true)
    setError(null)
    try {
      const result = await getUserAssignments(userId)
      setAssignments(result.assignments)
      setEditName(result.user.name)
      setEditEmail(result.user.email)
      setEditPassword('')
      setEditActive(result.user.isActive)
    } catch (err) {
      setAssignments([])
      setError(toErrorMessage(err, 'Gagal memuat assignment'))
    } finally {
      setLoadingAssignments(false)
    }
  }, [])

  useEffect(() => {
    void loadUsers(null)
  }, [loadUsers])

  useEffect(() => {
    if (selectedUserId == null) {
      setAssignments([])
      setEditName('')
      setEditEmail('')
      setEditPassword('')
      return
    }
    void loadAssignments(selectedUserId)
  }, [loadAssignments, selectedUserId])

  async function handleCreateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const created = await createUser({
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        isActive: newActive,
      })
      setNewName('')
      setNewEmail('')
      setNewPassword('')
      setNewActive(true)
      setMessage('Member berhasil dibuat.')
      await loadUsers(created.id)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal membuat member'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedUser) return

    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const updated = await updateUser({
        userId: selectedUser.id,
        name: editName.trim(),
        email: editEmail.trim(),
        password: editPassword || undefined,
        isActive: editActive,
      })
      setMessage('User berhasil diperbarui.')
      setEditPassword('')
      await loadUsers(updated.id)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal memperbarui user'))
    } finally {
      setSaving(false)
    }
  }

  function updateAssignment(deviceId: string, patch: Partial<AssignmentDraft>) {
    setAssignments((prev) =>
      prev.map((assignment) => {
        if (assignment.deviceId !== deviceId) {
          return assignment
        }

        const next: AssignmentDraft = {
          ...assignment,
          ...patch,
        }

        if (!next.assigned) {
          return {
            ...next,
            devicePermission: 'monitoring',
            schedulePermission: 'none',
          }
        }

        if (next.schedulePermission === 'manage' && !canUseScheduleManage(next.devicePermission)) {
          return {
            ...next,
            devicePermission: 'control',
          }
        }

        return next
      }),
    )
  }

  async function handleSaveAssignments() {
    if (!selectedUser) return

    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await replaceUserAssignments({
        userId: selectedUser.id,
        assignments: assignments.map((assignment) => ({
          deviceId: assignment.deviceId,
          assigned: assignment.assigned,
          devicePermission: assignment.devicePermission,
          schedulePermission: assignment.schedulePermission,
        })),
      })
      setMessage('Assignment berhasil disimpan.')
      await loadAssignments(selectedUser.id)
    } catch (err) {
      setError(toErrorMessage(err, 'Gagal menyimpan assignment'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="panel-shell user-manager">
      <div className="panel-head">
        <div>
          <h2>User Manager</h2>
          <p className="small">Kelola member dan akses device/jadwal.</p>
        </div>
      </div>

      {error ? <p className="error global-error">{error}</p> : null}
      {message ? <p className="success-message">{message}</p> : null}

      <div className="user-manager-grid">
        <form className="panel-form" onSubmit={(event) => void handleCreateMember(event)}>
          <h3>Create Member</h3>
          <label>
            Nama
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              minLength={1}
              maxLength={255}
              required
              disabled={saving}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              required
              disabled={saving}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
              disabled={saving}
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={newActive}
              onChange={(event) => setNewActive(event.target.checked)}
              disabled={saving}
            />
            Aktif
          </label>
          <button type="submit" disabled={saving || newPassword.length < 8 || !newName.trim() || !newEmail.trim()}>
            {saving ? 'Memproses...' : 'Buat Member'}
          </button>
        </form>

        <section className="member-list">
          <h3>Member</h3>
          {loadingUsers ? <p className="small">Memuat user...</p> : null}
          {!loadingUsers && members.length === 0 ? <p className="small">Belum ada member.</p> : null}
          <div className="user-table-wrap">
            <table className="user-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nama</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {members.map((user) => (
                  <tr key={user.id} className={user.id === selectedUserId ? 'selected' : ''}>
                    <td>{user.email}</td>
                    <td>{user.name}</td>
                    <td>{user.isActive ? 'Aktif' : 'Nonaktif'}</td>
                    <td>
                      <button
                        type="button"
                        className="table-button"
                        onClick={() => setSelectedUserId(user.id)}
                        disabled={saving || loadingAssignments}
                      >
                        Pilih
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selectedUser ? (
        <div className="assignment-area">
          <form className="panel-form member-edit-form" onSubmit={(event) => void handleSaveUser(event)}>
            <h3>Edit Member</h3>
            <label>
              Nama
              <input
                type="text"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                minLength={1}
                maxLength={255}
                required
                disabled={saving}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                required
                disabled={saving}
              />
            </label>
            <label>
              Reset Password
              <input
                type="password"
                value={editPassword}
                onChange={(event) => setEditPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                placeholder="Kosongkan jika tidak diubah"
                disabled={saving}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(event) => setEditActive(event.target.checked)}
                disabled={saving}
              />
              Aktif
            </label>
            <button
              type="submit"
              disabled={saving || !editName.trim() || !editEmail.trim() || (editPassword.length > 0 && editPassword.length < 8)}
            >
              {saving ? 'Menyimpan...' : 'Simpan User'}
            </button>
          </form>

          <section className="assignment-panel">
            <div className="assignment-head">
              <div>
                <h3>Assignment Device & Jadwal</h3>
                <p className="small">{selectedUser.name} - {selectedUser.email}</p>
              </div>
              <button
                type="button"
                className="panel-action"
                onClick={() => void handleSaveAssignments()}
                disabled={saving || loadingAssignments || assignments.length === 0}
              >
                {saving ? 'Menyimpan...' : 'Simpan Assignment'}
              </button>
            </div>

            {loadingAssignments ? <p className="small">Memuat assignment...</p> : null}
            {!loadingAssignments && assignments.length === 0 ? (
              <p className="small">Belum ada device untuk di-assign.</p>
            ) : null}

            <div className="assignment-table-wrap">
              <table className="assignment-table">
                <thead>
                  <tr>
                    <th>Assign</th>
                    <th>Device</th>
                    <th>Device Permission</th>
                    <th>Schedule Permission</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => {
                    const scheduleManageAllowed = canUseScheduleManage(assignment.devicePermission)
                    return (
                      <tr key={assignment.deviceId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={assignment.assigned}
                            onChange={(event) =>
                              updateAssignment(assignment.deviceId, { assigned: event.target.checked })
                            }
                            disabled={saving}
                            aria-label={`Assign ${assignment.name}`}
                          />
                        </td>
                        <td>
                          <strong>{assignment.name}</strong>
                          <p>
                            {assignment.deviceId}
                            {assignment.location ? ` - ${assignment.location}` : ''}
                          </p>
                        </td>
                        <td>
                          <select
                            value={assignment.devicePermission}
                            onChange={(event) =>
                              updateAssignment(assignment.deviceId, {
                                devicePermission: event.target.value as DevicePermission,
                                schedulePermission:
                                  event.target.value === 'monitoring' &&
                                  assignment.schedulePermission === 'manage'
                                    ? 'monitoring'
                                    : assignment.schedulePermission,
                              })
                            }
                            disabled={saving || !assignment.assigned}
                          >
                            {DEVICE_PERMISSION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={assignment.schedulePermission}
                            onChange={(event) =>
                              updateAssignment(assignment.deviceId, {
                                schedulePermission: event.target.value as SchedulePermission,
                              })
                            }
                            disabled={saving || !assignment.assigned}
                          >
                            {SCHEDULE_PERMISSION_OPTIONS.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={option.value === 'manage' && !scheduleManageAllowed}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {!scheduleManageAllowed ? (
                            <p className="permission-note">Manage perlu device control/manage.</p>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
