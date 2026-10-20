import { useState } from 'react'
import type { FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Field from '../components/Field'
import { Logo } from '../components/Icons'
import { APP_NAME, DEPARTMENT, LOGIN_IMAGE } from '../config'
import { api, rememberUser, setToken } from '../data/api'
import type { Role } from '../data/api'

const STEPS = [
  ['Add a seed variety', 'Enter the seed details once and print the QR label for its bags.'],
  ['The farmer scans the bag', 'Their phone shows the seed details and a short form. No app to install.'],
  ['The entry reaches this office', 'Even if the signal drops, it is kept on the phone and sent later.'],
]

function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const name = username.trim()
    setNameError(name === '' ? 'Enter your username' : '')
    setError(password === '' ? 'Enter your password' : '')
    if (name === '') {
      document.getElementById('username')?.focus()
      return
    }
    if (password === '') {
      document.getElementById('password')?.focus()
      return
    }
    setBusy(true)
    try {
      const signedIn = await api<{ token: string; username: string; role: Role }>('/login', {
        username: name,
        password,
      })
      rememberUser(signedIn.username || name, signedIn.role)
      setToken(signedIn.token)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <aside
        className={LOGIN_IMAGE ? 'signin-art has-photo' : 'signin-art'}
        style={LOGIN_IMAGE ? { backgroundImage: `url(${LOGIN_IMAGE})` } : undefined}
      >
        <div className="signin-top">
          <div className="brand">
            <Logo light />
            <span className="brand-text">
              <strong>{APP_NAME}</strong>
              <small>{DEPARTMENT}</small>
            </span>
          </div>

          {/* A picture of the printed label, so the page shows what the app makes. */}
          {!LOGIN_IMAGE && (
            <div className="signin-label" aria-hidden="true">
              <QRCodeSVG value="https://example.org/f/SAMPLE" size={68} level="M" />
              <div>
                <small>Sample label</small>
                <strong>Wheat, HD 2967</strong>
                <span>Batch/lot B-101</span>
              </div>
            </div>
          )}
        </div>

        <div className="signin-pitch">
          <h2>From seed bag to farmer record, in one scan.</h2>
          <ol className="signin-steps">
            {STEPS.map(([title, text], index) => (
              <li key={title}>
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <main id="main" className="signin-main">
        <form onSubmit={submit} noValidate>
          <div className="signin-heading">
            <h1>Sign in</h1>
            <p className="muted">Manage seed lots, QR labels and farmer entries.</p>
          </div>

          <Field id="username" label="Username" error={nameError}>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </Field>

          <Field id="password" label="Password" error={error}>
            <div className="input-with-button">
              <input
                id="password"
                type={visible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-pressed={visible}
                aria-label={visible ? 'Hide password' : 'Show password'}
              >
                {visible ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="signin-note">
            This page is for office staff. Farmers do not sign in: they only
            scan the QR code on the seed bag.
          </p>
        </form>
      </main>
    </div>
  )
}

export default SignIn
