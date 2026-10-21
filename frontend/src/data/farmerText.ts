import { DEFAULT_FORMS } from './forms'
import type { FieldSpec } from './forms'

// The farmer's form in Hindi or English. Farmers in Bihar mostly read
// Hindi, so it opens in Hindi; the choice is remembered on the phone.
// To change a word, change it here.

export type Lang = 'hi' | 'en'

const KEY = 'seedcode.lang'

export function savedLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'hi'
  } catch {
    return 'hi'
  }
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // Remembered for this visit only.
  }
}

export const TEXT = {
  en: {
    loading: 'Loading…',
    missingTitle: 'This code is not recognised',
    missingText:
      'Scan the QR code on the seed bag again. If it still does not work, tell the person who gave you the bag.',
    offlineTitle: 'No internet connection',
    offlineText: 'The seed details could not be loaded. Move to a place with signal and try again.',
    tryAgain: 'Try again',
    intro: 'Check the seed details, then fill in yours below.',
    seedDetails: 'Seed details',
    fromCode: 'From the code on this bag',
    waiting: (count: number) =>
      count === 1
        ? 'One earlier entry is saved on this phone and has not been sent yet.'
        : `${count} earlier entries are saved on this phone and have not been sent yet.`,
    sendNow: 'Send now',
    sent: 'Sent',
    sentText: 'Your details have been received. Thank you.',
    savedTitle: 'Saved on this phone',
    savedText:
      'There is no internet right now, so your details have not been sent yet. They will be sent by themselves when the signal comes back.',
    keepOpen: 'Keep this page open until it says “Sent”.',
    trySending: 'Try sending now',
    another: 'Fill in the form for another farmer',
    farmerDetails: 'Farmer details',
    required: 'Required',
    optional: 'Optional',
    whichDocument: 'Which document?',
    shortenList: 'Shorten the distribution channel list',
    typeToShorten: 'Type to shorten the list',
    nothingMatches: 'Nothing matches',
    chooseCount: (count: number) => `Choose (${count})`,
    choose: 'Choose…',
    privacy: (department: string) =>
      `${department} records these details together with information about this phone: its model, browser, screen and network address.`,
    saving: 'Saving…',
    submit: 'Submit',
    refused:
      'These details could not be accepted. Check them, and if this keeps happening, tell the person who gave you the bag.',
    notSent: 'Your details could not be sent or saved. Check your internet and press Submit again.',
    enterName: 'Enter the farmer’s name',
    chooseDocument: 'Choose a document type',
    enter: (label: string) => `Enter ${label.toLowerCase()}`,
    panShape: 'A PAN has 5 letters, 4 digits, then 1 letter',
    enterMobile: 'Enter a mobile number',
    mobileDigits: 'Enter a 10 digit mobile number, without spaces',
    chooseChannel: 'Choose a distribution channel',
    enterNumber: 'Enter a number',
  },
  hi: {
    loading: 'लोड हो रहा है…',
    missingTitle: 'यह कोड पहचाना नहीं गया',
    missingText:
      'बीज के थैले पर लगा QR कोड फिर से स्कैन करें। अगर फिर भी काम न करे, तो जिन्होंने आपको थैला दिया है उन्हें बताएँ।',
    offlineTitle: 'इंटरनेट कनेक्शन नहीं है',
    offlineText: 'बीज की जानकारी लोड नहीं हो सकी। नेटवर्क वाली जगह पर जाकर फिर से कोशिश करें।',
    tryAgain: 'फिर से कोशिश करें',
    intro: 'बीज की जानकारी जाँच लें, फिर नीचे अपनी जानकारी भरें।',
    seedDetails: 'बीज की जानकारी',
    fromCode: 'इस थैले के कोड से',
    waiting: (count: number) =>
      count === 1
        ? 'पिछली एक प्रविष्टि इस फ़ोन में सेव है और अभी भेजी नहीं गई है।'
        : `पिछली ${count} प्रविष्टियाँ इस फ़ोन में सेव हैं और अभी भेजी नहीं गई हैं।`,
    sendNow: 'अभी भेजें',
    sent: 'भेज दिया गया',
    sentText: 'आपकी जानकारी मिल गई है। धन्यवाद।',
    savedTitle: 'इस फ़ोन में सेव हो गया',
    savedText:
      'अभी इंटरनेट नहीं है, इसलिए आपकी जानकारी अभी भेजी नहीं गई है। नेटवर्क वापस आने पर यह अपने आप भेज दी जाएगी।',
    keepOpen: 'जब तक “भेज दिया गया” न दिखे, यह पेज खुला रखें।',
    trySending: 'अभी भेजने की कोशिश करें',
    another: 'दूसरे किसान के लिए फ़ॉर्म भरें',
    farmerDetails: 'किसान की जानकारी',
    required: 'ज़रूरी',
    optional: 'वैकल्पिक',
    whichDocument: 'कौन सा दस्तावेज़?',
    shortenList: 'वितरण चैनल की सूची छोटी करें',
    typeToShorten: 'सूची छोटी करने के लिए लिखें',
    nothingMatches: 'कुछ नहीं मिला',
    chooseCount: (count: number) => `चुनें (${count})`,
    choose: 'चुनें…',
    privacy: (department: string) =>
      `${department} इस जानकारी के साथ इस फ़ोन की जानकारी भी दर्ज करता है: मॉडल, ब्राउज़र, स्क्रीन और नेटवर्क पता।`,
    saving: 'सेव हो रहा है…',
    submit: 'जमा करें',
    refused:
      'यह जानकारी स्वीकार नहीं हो सकी। इसे जाँचें, और अगर बार-बार ऐसा हो तो जिन्होंने आपको थैला दिया है उन्हें बताएँ।',
    notSent: 'आपकी जानकारी न भेजी जा सकी, न सेव हो सकी। इंटरनेट जाँचें और फिर से “जमा करें” दबाएँ।',
    enterName: 'किसान का नाम लिखें',
    chooseDocument: 'दस्तावेज़ का प्रकार चुनें',
    enter: (label: string) => `${label} लिखें`,
    panShape: 'PAN में 5 अक्षर, 4 अंक और फिर 1 अक्षर होता है',
    enterMobile: 'मोबाइल नंबर लिखें',
    mobileDigits: 'बिना खाली जगह के 10 अंकों का मोबाइल नंबर लिखें',
    chooseChannel: 'वितरण चैनल चुनें',
    enterNumber: 'संख्या लिखें',
  },
}

export type Text = (typeof TEXT)['en']

// What the fixed choices are called. The answer saved stays in English.
export const CHOICES: Record<Lang, Record<string, string>> = {
  en: {},
  hi: {
    Farmer: 'किसान',
    'Field officer': 'फ़ील्ड अधिकारी',
    'Aadhaar ID': 'आधार',
    'PAN ID': 'PAN कार्ड',
    Other: 'अन्य',
  },
}

// The built-in questions in Hindi, by their key.
const HINDI: Record<'lot' | 'farmer', Record<string, { label: string; hint?: string }>> = {
  lot: {
    date: { label: 'तारीख' },
    seedType: { label: 'बीज का प्रकार', hint: 'जैसे हाइब्रिड, प्रमाणित या आधार बीज' },
    crop: { label: 'बोने के लिए फ़सल' },
    variety: { label: 'किस्म' },
    batchNo: { label: 'बैच/लॉट नंबर' },
    productionSource: { label: 'उत्पादन स्रोत' },
    certification: { label: 'प्रमाणन विवरण' },
    expiryDate: { label: 'समाप्ति तिथि' },
    storageLocation: { label: 'भंडारण स्थान' },
    packingLocation: { label: 'पैकिंग स्थान' },
  },
  farmer: {
    date: { label: 'तारीख' },
    filledBy: { label: 'यह फ़ॉर्म कौन भर रहा है?' },
    farmerName: { label: 'किसान का नाम' },
    kycType: { label: 'दस्तावेज़ / KYC का प्रकार' },
    idNumber: { label: 'पहचान संख्या (ID नंबर)' },
    contact: { label: 'मोबाइल नंबर' },
    channel: {
      label: 'वितरण चैनल',
      hint: 'सूची लंबी है। छोटा करने के लिए नाम या गाँव का कुछ हिस्सा लिखें।',
    },
    landholding: { label: 'ज़मीन (जोत) का आकार' },
    quantity: { label: 'दिए गए बीज की मात्रा' },
  },
}

// The questions in the chosen language. A built-in question the office
// renamed keeps the office's words; questions the office added are shown
// as typed, which can be in Hindi.
export function localize(fields: FieldSpec[], form: 'lot' | 'farmer', lang: Lang): FieldSpec[] {
  if (lang === 'en') return fields
  return fields.map((field) => {
    const hindi = HINDI[form][field.key]
    const original = DEFAULT_FORMS[form].find((spec) => spec.key === field.key)
    if (!field.builtin || !hindi || !original) return field
    return {
      ...field,
      label: field.label === original.label ? hindi.label : field.label,
      hint: field.hint === original.hint ? (hindi.hint ?? field.hint) : field.hint,
    }
  })
}
