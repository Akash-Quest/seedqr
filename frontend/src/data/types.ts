import type { FieldSpec } from './forms'

// What the admin enters for one batch of seed. One QR code per lot.
export type SeedLot = {
  id: string
  date: string // YYYY-MM-DD
  seedType: string
  crop: string
  variety: string
  batchNo: string
  productionSource: string
  certification: string
  expiryDate: string // YYYY-MM-DD or ''
  storageLocation: string
  packingLocation: string
  createdAt: string
  // Set when the office has changed the details since the label was made.
  updatedAt?: string | null
  entryCount?: number
  // Only in the answer to adding a lot: true when one with the same crop,
  // variety and batch was already here, and this is that lot.
  existing?: boolean
  // Answers to questions the office added itself, by question key.
  extra?: Record<string, string>
}

// What a farmer's phone gets after scanning: the lot and both forms.
export type PublicLot = SeedLot & {
  lotFields?: FieldSpec[]
  farmerFields?: FieldSpec[]
}

export type NewSeedLot = Omit<
  SeedLot,
  'id' | 'createdAt' | 'updatedAt' | 'entryCount' | 'existing'
>

export type KycType = '' | 'Aadhaar ID' | 'PAN ID' | 'Other'

// What is filled in on the phone after scanning a bag.
export type FarmerEntry = {
  id: string
  lotId: string
  date: string // YYYY-MM-DD or ''
  filledBy: 'Farmer' | 'Field officer'
  farmerName: string
  kycType: KycType
  kycOther: string
  idNumber: string
  contact: string
  channel: string
  landholding: string
  quantity: string
  filledAt: string
  deviceId: string
  fingerprint: string
  userAgent: string
  // What the phone reported about itself, as label -> value.
  device: Record<string, string>
  // Answers to questions the office added itself, by question key.
  extra: Record<string, string>
}

export type ReceivedEntry = FarmerEntry & {
  receivedAt: string
  // Network address the entry arrived from, as seen by the server.
  ipAddress: string
  lot: SeedLot | null
  // Set once the office has corrected the entry: when, and who.
  updatedAt?: string | null
  updatedBy?: string | null
}

// One page of the entries list, and how many match in all.
export type EntryPage = { items: ReceivedEntry[]; total: number }

// How many entries each crop had, by crop name.
export type CropCounts = Record<string, number>

// The numbers behind the dashboard's charts, counted by the server.
export type Stats = {
  // Every crop that has ever had an entry, oldest first.
  series: string[]
  // What the counts are split by: the series are crops, or (when every
  // entry is of one crop) varieties.
  by: 'crop' | 'variety'
  // When the very first and the latest entry came in, or null with none yet.
  first: string | null
  last: string | null
  // How many distribution channels had an entry in the period.
  channelCount: number
  // How many seed lots had an entry in the period.
  lotCount: number
  // Entries in the period of the same length just before this one.
  previous: number
  // One per day or week.
  columns: CropCounts[]
  channels: { name: string; counts: CropCounts }[]
}

// Someone in the office who can sign in.
export type StaffAccount = {
  id: number
  username: string
  role: 'admin' | 'editor' | 'viewer'
  active: boolean
  createdAt: string
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
