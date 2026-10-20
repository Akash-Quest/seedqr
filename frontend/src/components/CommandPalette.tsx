import { useEffect, useRef, useState } from 'react'
import type { ComponentType, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { canEdit, isAdmin, useApi } from '../data/api'
import type { SeedLot } from '../data/types'
import {
  ChannelIcon,
  DashboardIcon,
  EditIcon,
  PlusIcon,
  QrIcon,
  SearchIcon,
  StaffIcon,
  UploadIcon,
  UsersIcon,
} from './Icons'

type Command = {
  key: string
  group: string
  label: string
  hint?: string
  icon: ComponentType
  to: string
}

const MOST_LOTS = 6

// Everything in the office pages, a few keystrokes away: Ctrl+K (or ⌘K on
// a Mac) opens it from anywhere.
function CommandPalette({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const lots = useApi<SeedLot[]>('/lots').data ?? []

  useEffect(() => {
    const box = dialog.current
    if (box && !box.open) box.showModal()
  }, [])

  const needle = text.trim().toLowerCase()
  const matches = (...words: string[]) => !needle || words.some((w) => w.toLowerCase().includes(needle))

  const fixed: Command[] = [
    { key: 'dash', group: 'Pages', label: 'Dashboard', icon: DashboardIcon, to: '/' },
    { key: 'lots', group: 'Pages', label: 'Seed lots and QR codes', icon: QrIcon, to: '/barcode' },
    { key: 'farmers', group: 'Pages', label: 'Farmer entries', icon: UsersIcon, to: '/users' },
    { key: 'channels', group: 'Pages', label: 'Distribution channels', icon: ChannelIcon, to: '/channels' },
    ...(isAdmin()
      ? [{ key: 'staff', group: 'Pages', label: 'Staff accounts', icon: StaffIcon, to: '/staff' }]
      : []),
    ...(canEdit()
      ? [
          { key: 'new', group: 'Actions', label: 'Add a seed variety', icon: PlusIcon, to: '/barcode?new=1' },
          { key: 'import', group: 'Actions', label: 'Import farmer entries from Excel', icon: UploadIcon, to: '/users?import=1' },
        ]
      : []),
    ...(isAdmin()
      ? [{ key: 'fields', group: 'Actions', label: 'Change the form questions', icon: EditIcon, to: '/barcode?fields=1' }]
      : []),
  ].filter((command) => matches(command.label, command.group))

  const lotCommands: Command[] = needle
    ? lots
        .filter((lot) => matches(lot.crop, lot.variety, lot.batchNo, lot.id))
        .slice(0, MOST_LOTS)
        .map((lot) => ({
          key: `lot-${lot.id}`,
          group: 'Seed lots',
          label: `${lot.crop}, ${lot.variety}`,
          hint: `batch ${lot.batchNo} · ${lot.entryCount ?? 0} entries`,
          icon: QrIcon,
          to: `/barcode?lot=${lot.id}`,
        }))
    : []

  const search: Command[] = needle
    ? [
        {
          key: 'search',
          group: 'Farmer entries',
          label: `Search entries for “${text.trim()}”`,
          hint: 'names, phone numbers, channels, crops and batches',
          icon: SearchIcon,
          to: `/users?q=${encodeURIComponent(text.trim())}`,
        },
      ]
    : []

  const commands = [...search, ...fixed, ...lotCommands]
  const current = Math.min(active, commands.length - 1)

  function run(command: Command | undefined) {
    if (!command) return
    onClose()
    navigate(command.to)
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current + 1) % commands.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current - 1 + commands.length) % commands.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(commands[current])
    }
  }

  let group = ''
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Go to or search"
      onCancel={onClose}
      onClose={onClose}
      // A click on the dimmed backdrop, outside the box, closes it.
      onClick={(event) => event.target === dialog.current && onClose()}
    >
      <div className="palette-box">
        <label className="palette-search">
          <SearchIcon />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={commands[current] ? `palette-${commands[current].key}` : undefined}
            placeholder="Go to a page, find a seed lot, or search farmers…"
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" id="palette-list" role="listbox">
          {commands.length === 0 && <li className="palette-empty">Nothing matches.</li>}
          {commands.map((command, index) => {
            const heading = command.group !== group ? command.group : ''
            group = command.group
            const Icon = command.icon
            return (
              <li key={command.key} role="presentation">
                {heading && <p className="palette-group">{heading}</p>}
                <div
                  id={`palette-${command.key}`}
                  role="option"
                  aria-selected={index === current}
                  className={index === current ? 'palette-item on' : 'palette-item'}
                  onPointerMove={() => index !== current && setActive(index)}
                  onClick={() => run(command)}
                >
                  <Icon />
                  <span>
                    {command.label}
                    {command.hint && <small>{command.hint}</small>}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
        <p className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
        </p>
      </div>
    </dialog>
  )
}

export default CommandPalette
