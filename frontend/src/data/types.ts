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
  // Answers to questions the office added itself, by question key.
  extra?: Record<string, string>
}

// What a farmer's phone gets after scanning: the lot and both forms.
export type PublicLot = SeedLot & {
  lotFields?: FieldSpec[]
  farmerFields?: FieldSpec[]
}

export type NewSeedLot = Omit<SeedLot, 'id' | 'createdAt' | 'updatedAt' | 'entryCount'>

export type KycType = '' | 'Aadhaar ID' | 'PAN ID' | 'Other'

// What is filled in on the phone after scanning a bag.
export type FarmerEntry = {
  id: string
  lotId: string
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
