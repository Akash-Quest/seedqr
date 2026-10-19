import { dismiss, useToasts } from '../data/toast'
import { AlertIcon, CheckIcon, CloseIcon, SparkIcon } from './Icons'

// The corner where short confirmations appear (see data/toast.ts).
function Toaster() {
  const toasts = useToasts()
  return (
    <ol className="toaster" aria-live="polite" aria-label="Messages">
      {toasts.map((item) => (
        <li key={item.id} className={`toast ${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
          <span className="toast-icon" aria-hidden="true">
            {item.tone === 'error' ? <AlertIcon /> : item.tone === 'info' ? <SparkIcon /> : <CheckIcon />}
          </span>
          <span className="toast-text">{item.text}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => dismiss(item.id)}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ol>
  )
}

export default Toaster
