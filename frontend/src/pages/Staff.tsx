import { useState } from 'react'
import type { FormEvent } from 'react'
import Field from '../components/Field'
import PageHeader from '../components/PageHeader'
import { ROLE_NAMES, api, signedInUsername, useApi } from '../data/api'
import type { Role } from '../data/api'
import { formatDate } from '../data/types'
import type { StaffAccount } from '../data/types'

const ROLES: Role[] = ['viewer', 'editor', 'admin']

const ROLE_HELP: Record<Role, string> = {
  viewer: 'Sees the dashboard, seed lots and farmer entries. ID numbers are shortened.',
  editor: 'Also adds, changes and deletes seed lots, and imports and exports entries.',
  admin: 'Also changes the form questions and manages these accounts.',
}

const MIN_PASSWORD = 8

function Staff() {
  const { data, error, reload } = useApi<StaffAccount[]>('/staff')

  return (
    <>
      <PageHeader title="Staff" subtitle="People in the office who can sign in." />

      <div className="page">
        {error ? (
          <p className="problem">{error}</p>
        ) : !data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <NewAccount onAdded={reload} />

            <section className="card">
              <div className="card-head">
                <h2>Accounts</h2>
                <p>{data.length} in all</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Added</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((account) => (
                      <AccountRow key={account.id} account={account} onChanged={reload} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>What each role can do</h2>
              </div>
              <ul className="rows">
                {ROLES.map((role) => (
                  <li key={role}>
                    <span>
                      <strong>{ROLE_NAMES[role]}</strong>{' '}
                      <span className="muted">{ROLE_HELP[role]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  )
}

function RoleSelect({ id, value, onChange }: { id?: string; value: Role; onChange: (role: Role) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Role)}>
      {ROLES.map((role) => (
        <option key={role} value={role}>
          {ROLE_NAMES[role]}
        </option>
      ))}
    </select>
  )
}

function NewAccount({ onAdded }: { onAdded: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    if (username.trim().length < 3) found.newUsername = 'Enter a username of at least 3 characters'
    if (password.trim().length < MIN_PASSWORD)
      found.newPassword = `Enter a password of at least ${MIN_PASSWORD} characters`
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      document.getElementById(firstBad)?.focus()
      return
    }

    setBusy(true)
    setFailure('')
    try {
      await api('/staff', { username: username.trim(), password, role })
      setUsername('')
      setPassword('')
      setRole('viewer')
      onAdded()
    } catch (err) {
      setFailure((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <form className="card" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>Add an account</h2>
        <p>Give the username and password to the person yourself.</p>
      </div>

      <div className="card-body form-grid">
        <Field
          id="newUsername"
          label="Username"
          hint="At least 3 characters. Capitals do not matter."
          error={errors.newUsername}
        >
          <input
            id="newUsername"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field
          id="newPassword"
          label="Password"
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={errors.newPassword}
        >
          <input
            id="newPassword"
            className="mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field id="newRole" label="Role" hint={ROLE_HELP[role]} className="full">
          <RoleSelect id="newRole" value={role} onChange={setRole} />
        </Field>
      </div>

      <div className="card-foot end">
        {failure && (
          <p className="grow error" role="alert">
            {failure}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Adding…' : 'Add account'}
        </button>
      </div>
    </form>
  )
}

function AccountRow({ account, onChanged }: { account: StaffAccount; onChanged: () => void }) {
  // The new password being typed, or null when the box is closed.
  const [password, setPassword] = useState<string | null>(null)
  const [failure, setFailure] = useState('')
  const isMe = account.username === signedInUsername()

  async function change(patch: Partial<Pick<StaffAccount, 'role' | 'active'>> & { password?: string }) {
    setFailure('')
    try {
      await api(
        `/staff/${account.id}`,
        { role: account.role, active: account.active, ...patch },
        'PUT',
      )
      setPassword(null)
      onChanged()
    } catch (err) {
      setFailure((err as Error).message)
    }
  }

  return (
    <tr>
      <td>
        <strong>{account.username}</strong>
        {isMe && <span className="muted"> (you)</span>}
      </td>
      <td>
        <RoleSelect value={account.role} onChange={(role) => void change({ role })} />
      </td>
      <td>{account.active ? 'Can sign in' : 'Switched off'}</td>
      <td>{formatDate(account.createdAt)}</td>
      <td className="row-actions">
        {failure && <span className="error">{failure}</span>}
        {password === null ? (
          <>
            <button type="button" className="link-button" onClick={() => setPassword('')}>
              Set a new password
            </button>
            <button
              type="button"
              className={account.active ? 'link-button danger' : 'link-button'}
              onClick={() => void change({ active: !account.active })}
            >
              {account.active ? 'Switch off' : 'Switch on'}
            </button>
          </>
        ) : (
          <>
            <input
              className="mono"
              aria-label={`New password for ${account.username}`}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button type="button" className="link-button" onClick={() => setPassword(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="link-button"
              disabled={password.trim().length < MIN_PASSWORD}
              onClick={() => void change({ password })}
            >
              Save{isMe ? ' and sign in again' : ''}
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

export default Staff
