// crypto.randomUUID is missing on plain http pages, so fall back.
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// A random ID kept in this browser. Stays the same until site data is cleared.
export function getDeviceId(): string {
  const key = 'seedcode.deviceId'
  try {
    let id = localStorage.getItem(key)
    if (!id) {
      id = newId()
      localStorage.setItem(key, id)
    }
    return id
  } catch {
    return ''
  }
}

export type DeviceInfo = {
  fingerprint: string
  // Label -> value, already worded for the office to read.
  device: Record<string, string>
}

// Parts of the browser that TypeScript's built-in types do not describe.
type ExtraNavigator = Navigator & {
  deviceMemory?: number
  connection?: { effectiveType?: string }
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{
      model?: string
      platform?: string
      platformVersion?: string
    }>
  }
}

function operatingSystem(ua: string): string {
  const android = ua.match(/Android ([\d.]+)/)
  if (android) return `Android ${android[1]}`
  const ios = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/)
  if (ios) return `iOS ${ios[1].replace(/_/g, '.')}`
  if (/Windows NT 10/.test(ua)) return 'Windows 10 or 11'
  if (/Windows/.test(ua)) return 'Windows'
  const mac = ua.match(/Mac OS X ([\d_]+)/)
  if (mac) return `macOS ${mac[1].replace(/_/g, '.')}`
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

function browser(ua: string): string {
  // Order matters: most browsers also claim to be Chrome or Safari.
  const known: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/UCBrowser\/([\d.]+)/, 'UC Browser'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ]
  for (const [pattern, name] of known) {
    const found = ua.match(pattern)
    if (found) return `${name} ${found[1].split('.')[0]}`
  }
  return ''
}

// Older Android browsers put the phone model in the user agent.
function modelFromUserAgent(ua: string): string {
  const found = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/)
  const model = found?.[1].trim() ?? ''
  return model === 'K' ? '' : model // "K" is Chrome's placeholder
}

async function collect(): Promise<DeviceInfo> {
  const nav = navigator as ExtraNavigator
  const ua = nav.userAgent
  const device: Record<string, string> = {}
  const add = (label: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') device[label] = String(value)
  }

  // Newer Chrome on Android only gives the model through this call, and only
  // on https pages.
  let hints: { model?: string; platform?: string; platformVersion?: string } = {}
  try {
    hints = (await nav.userAgentData?.getHighEntropyValues(['model', 'platformVersion'])) ?? {}
  } catch {
    // Not available: fall back to the user agent.
  }

  add('Phone model', hints.model || modelFromUserAgent(ua))
  add(
    'Operating system',
    hints.platform === 'Android' && hints.platformVersion
      ? `Android ${hints.platformVersion.split('.')[0]}`
      : operatingSystem(ua),
  )
  add('Browser', browser(ua))
  add('Device type', nav.maxTouchPoints > 0 && screen.width < 900 ? 'Phone or tablet' : 'Computer')
  add('Screen size', `${screen.width} × ${screen.height}`)
  add('Pixel ratio', window.devicePixelRatio)
  add('Touch points', nav.maxTouchPoints)
  add('Language', nav.languages?.join(', ') || nav.language)
  add('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone)
  add('Processor cores', nav.hardwareConcurrency)
  add('Memory', nav.deviceMemory ? `${nav.deviceMemory} GB or more` : '')
  add('Connection', nav.connection?.effectiveType)
  add('Platform', nav.platform)
  add('Maker', nav.vendor)

  let fingerprint = ''
  try {
    // Loaded only here, so the form itself shows sooner on a slow phone.
    const { default: FingerprintJS } = await import('@fingerprintjs/fingerprintjs')
    const agent = await FingerprintJS.load({ monitoring: false })
    const result = await agent.get()
    fingerprint = result.visitorId
    add('Fingerprint confidence', `${Math.round(result.confidence.score * 100)}%`)
  } catch {
    // Blocked by the browser: the other details are still sent.
  }

  return { fingerprint, device }
}

let info: Promise<DeviceInfo> | undefined

// Worked out on the phone itself, so it needs no internet.
export function getDeviceInfo(): Promise<DeviceInfo> {
  info ??= collect().catch(() => ({ fingerprint: '', device: {} }))
  return info
}
