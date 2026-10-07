import { useState } from 'react'
import type { FormEvent } from 'react'
import { EditIcon, PlusIcon, TrashIcon } from './Icons'

type ChannelEditorProps = {
  channels: string[]
  onChange: (channels: string[]) => void
}

// Add, rename and remove distribution channels. Changes are kept with the
// rest of the farmer form and saved by its "Save form" button.
function ChannelEditor({ channels, onChange }: ChannelEditorProps) {
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState('')
  const [problem, setProblem] = useState('')
  // The channel being renamed, and its new name so far.
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null)

  const tidy = (name: string) => name.split(/\s+/).filter(Boolean).join(' ')
  const exists = (name: string) =>
    channels.some((c) => c.toLowerCase() === name.toLowerCase())

  function add(e: FormEvent) {
    e.preventDefault()
    const name = tidy(adding)
    if (!name) return
    if (exists(name)) {
      setProblem('That channel is already in the list.')
      return
    }
    onChange([name, ...channels])
    setAdding('')
    setProblem('')
  }

  function rename() {
    if (!editing) return
    const name = tidy(editing.to)
    if (!name) {
      setProblem('A channel needs a name.')
      return
    }
    if (name !== editing.from && exists(name)) {
      setProblem('That channel is already in the list.')
      return
    }
    onChange(channels.map((c) => (c === editing.from ? name : c)))
    setEditing(null)
    setProblem('')
  }

  function remove(name: string) {
    if (channels.length === 1) {
      setProblem('Keep at least one channel.')
      return
    }
    onChange(channels.filter((c) => c !== name))
    setProblem('')
  }

  const needle = search.trim().toLowerCase()
  const shown = channels.filter((c) => c.toLowerCase().includes(needle))

  return (
    <div className="channels">
      <form className="channels-add" onSubmit={add}>
        <input
          aria-label="New channel"
          placeholder="New channel, for example “Rampur Pacs - Block Sakra, District Muzaffarpur”"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <button type="submit" className="secondary" disabled={!tidy(adding)}>
          <PlusIcon />
          Add channel
        </button>
      </form>

      <div className="channels-search">
        <input
          type="search"
          aria-label="Search channels"
          placeholder="Search channels"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted">
          {needle ? `${shown.length} of ${channels.length}` : `${channels.length} channels`}
        </span>
      </div>

      {problem && <p className="error">{problem}</p>}

      <ul className="channels-list">
        {shown.map((name) =>
          editing?.from === name ? (
            <li key={name} className="is-editing">
              <input
                aria-label="Channel name"
                value={editing.to}
                autoFocus
                onChange={(e) => setEditing({ from: name, to: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    rename()
                  }
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
              <button type="button" className="link-button" onClick={rename}>
                Done
              </button>
              <button type="button" className="link-button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </li>
          ) : (
            <li key={name}>
              <span>{name}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Rename ${name}`}
                title="Rename"
                onClick={() => setEditing({ from: name, to: name })}
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remove ${name}`}
                title="Remove"
                onClick={() => remove(name)}
              >
                <TrashIcon />
              </button>
            </li>
          ),
        )}
        {shown.length === 0 && <li className="muted">No channel matches.</li>}
      </ul>
    </div>
  )
}

export default ChannelEditor
