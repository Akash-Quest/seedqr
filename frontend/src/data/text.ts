// Tidier text for showing on screen. What is stored, exported and searched
// stays exactly as it was typed.

// Each word with a capital first letter and the rest small, however it was
// typed: "HARI NARAYAN SINGH" and "hari narayan singh" both read
// "Hari Narayan Singh". Hindi has no capitals and is left as it is.
export function titleCase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
}

// A quantity in small letters with a space before its unit: "2KG" and
// "2kg" both read "2 kg", "500g" reads "500 g".
export function tidyQuantity(text: string): string {
  return text.trim().toLowerCase().replace(/(\d)\s*([a-z])/g, '$1 $2')
}
