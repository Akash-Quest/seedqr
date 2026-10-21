// Which district a distribution channel is in. Nothing records it as such:
// it is written somewhere in the channel's name, in many forms ("District -
// Gaya", "Dist-Bhojpur", "dis purnea", or just the town at the end of the
// address). Each district is listed with the ways it is written: other
// spellings, and the headquarters and other well-known towns in it.

export const DISTRICTS: Record<string, string[]> = {
  'West Champaran': ['west champaran', 'paschim champaran', 'pashchim champaran', 'bettiah', 'bagaha'],
  'East Champaran': ['east champaran', 'purba champaran', 'purbi champaran', 'motihari'],
  Sitamarhi: ['sitamarhi', 'sitamadhi'],
  Sheohar: ['sheohar', 'shivhar'],
  Gopalganj: ['gopalganj'],
  Samastipur: ['samastipur'],
  Katihar: ['katihar'],
  Khagaria: ['khagaria', 'khagadia'],
  Bhojpur: ['bhojpur', 'arrah', 'arah', 'ara'],
  Buxar: ['buxar', 'baxar'],
  Darbhanga: ['darbhanga'],
  Saharsa: ['saharsa'],
  Kaimur: ['kaimur', 'bhabua', 'bhabhua'],
  Rohtas: ['rohtas', 'rohtash', 'sasaram', 'dehri'],
  Jamui: ['jamui', 'jaumi'],
  Banka: ['banka'],
  Nawada: ['nawada', 'nawadah'],
  Gaya: ['gaya'],
  Munger: ['munger', 'monghyr'],
  Vaishali: ['vaishali', 'hajipur'],
  Begusarai: ['begusarai'],
  Bhagalpur: ['bhagalpur'],
  Lakhisarai: ['lakhisarai'],
  Sheikhpura: ['sheikhpura', 'shekhpura'],
  Arwal: ['arwal'],
  Jehanabad: ['jehanabad', 'jahanabad'],
  Nalanda: ['nalanda', 'bihar sharif', 'biharsharif'],
  Patna: ['patna'],
  Saran: ['saran', 'chapra', 'chhapra'],
  Siwan: ['siwan', 'sewan'],
  Muzaffarpur: ['muzaffarpur', 'muzzafarpur', 'muzafarpur', 'muzaffarpu', 'mujaffarpur'],
  Madhepura: ['madhepura'],
  Araria: ['araria'],
  Supaul: ['supaul', 'supual'],
  Madhubani: ['madhubani', 'madubani'],
  Purnia: ['purnia', 'purnea'],
  Kishanganj: ['kishanganj'],
  Aurangabad: ['aurangabad'],
}

// Places found in channel names that lie in one district only: blocks and
// villages, and misspellings seen in the data. A name shared by places in
// two districts (Raghopur, Sonbarsa) is left out rather than guessed.
const PLACES: Record<string, string[]> = {
  Lakhisarai: ['lakhisara', 'surajgarha', 'surajgarh', 'jankidih', 'jankdih'],
  Vaishali: ['vaishli'],
  Madhepura: ['singheshwar'],
  Supaul: ['chhatapur', 'chatapur', 'chattapur', 'triveniganj', 'nirmali', 'pratapganj'],
  Saharsa: ['kahra'],
  Bhojpur: ['charpokhari'],
  Purnia: ['srinagar', 'k nager', 'k nagar', 'krityanand nagar'],
  Sheikhpura: ['shekhopur sarai', 'shekhupur sarai', 'sheikhopur sarai', 'barbigha'],
  Saran: ['masharakh', 'revelganj'],
}

// Channels whose names do not say their district, as the office told us:
// by the organisation part of the name, so every way it was typed counts.
const KNOWN: Record<string, string> = {
  'gaghopur agri farmer producer company ltd': 'Supaul',
  'mahaveer jivika mahila gram sangathan dighri': 'Rohtas',
  'arma pacs': 'Nalanda',
}

// Names trusted only right after "Block": "Block - Kishanpur" is the block
// in Supaul, though villages called Kishanpur are everywhere.
const BLOCKS: Record<string, string> = {
  kishanpur: 'Supaul',
}

// Words that say "the district is next": "District - Gaya", "Dist. Gaya".
const MARKER = /\b(?:district|distt|dist|dis|dt|zila|jila)\b/g
const BLOCK = /\b(?:block|prakhand)\b/g

// Every way of writing a district, longest first, so "east champaran" is
// tried before anything shorter inside it.
const ALIASES: [string, string][] = [...Object.entries(DISTRICTS), ...Object.entries(PLACES)]
  .flatMap(([district, names]) => names.map((name): [string, string] => [name, district]))
  .sort((a, b) => b[0].length - a[0].length)

// Lower case letters and single spaces only, with a space at each end, so
// a name is found only as whole words.
function plain(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z]+/g, ' ').trim()} `
}

// The district a channel's name gives, or null when it does not say.
export function districtOf(channel: string): string | null {
  // What the office told us comes first.
  const known = KNOWN[organisation(channel)]
  if (known) return known
  const text = plain(channel)
  // A district named right after "District" (or "Dist", "dis") wins.
  for (const marker of text.matchAll(MARKER)) {
    const after = text.slice((marker.index ?? 0) + marker[0].length)
    for (const [name, district] of ALIASES) {
      if (after.startsWith(` ${name} `)) return district
    }
  }
  // Otherwise the last district named: an address runs from the village to
  // the district.
  let best: { at: number; district: string } | null = null
  for (const [name, district] of ALIASES) {
    const at = text.lastIndexOf(` ${name} `)
    if (at >= 0 && (best === null || at > best.at)) best = { at, district }
  }
  if (best) return best.district
  // Last, a block known to be in one district.
  for (const marker of text.matchAll(BLOCK)) {
    const after = text.slice((marker.index ?? 0) + marker[0].length)
    for (const [name, district] of Object.entries(BLOCKS)) {
      if (after.startsWith(` ${name} `)) return district
    }
  }
  return null
}

// The organisation part of a channel's name: what comes before the address.
function organisation(channel: string): string {
  return plain(channel.split(/\s*[-–]\s*/)[0]).trim()
}

// The district of each channel. A channel whose name gives none takes the
// district of another channel of the same organisation that does (the same
// channel, typed with and without its address), when they all agree.
export function districtsOf(channels: string[]): Map<string, string | null> {
  const found = new Map(channels.map((name) => [name, districtOf(name)]))
  const byOrganisation = new Map<string, Set<string>>()
  for (const [name, district] of found) {
    if (!district) continue
    const key = organisation(name)
    if (!byOrganisation.has(key)) byOrganisation.set(key, new Set())
    byOrganisation.get(key)!.add(district)
  }
  for (const [name, district] of found) {
    if (district) continue
    const same = byOrganisation.get(organisation(name))
    if (same?.size === 1) found.set(name, [...same][0])
  }
  return found
}
