import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on the LAN address too, so phones on the same Wi-Fi can open the app.
    host: true,
    port: 5174,
    strictPort: true,
    // The Python backend (see ../backend). Start it before using the app.
    // xfwd passes the phone's network address on to the backend.
    proxy: { '/api': { target: 'http://127.0.0.1:8010', xfwd: true } },
  },
})
