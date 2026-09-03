import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    /* Source maps in production.

       Without these, a crash reports a position inside a minified file
       (index-abc123.js:95:74048) which names nothing and cannot be acted
       on. With them, the browser console and the app's own error screen
       name the real file and line — Dashboard.jsx:416, and so on.

       They add .map files to the build. Those are downloaded only when
       DevTools is open, so normal users never pay for them, and they
       contain no secrets: your source is already in the browser. */
    sourcemap: true
  }
})
