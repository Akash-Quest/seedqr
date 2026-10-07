// Change these two lines to rebrand the whole app.
export const APP_NAME = 'SeedCode'
export const DEPARTMENT = 'Department name'

// Picture on the left of the sign-in page. Put a photo in the public folder
// and name it here, for example '/login.jpg'. Empty shows the built-in drawing.
export const LOGIN_IMAGE = ''

// The address printed inside each QR code. Set VITE_PUBLIC_URL when the admin
// opens the app on a different address from the one farmers will use.
export const PUBLIC_URL: string = (
  import.meta.env.VITE_PUBLIC_URL || window.location.origin
).replace(/\/$/, '')
