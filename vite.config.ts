import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite 建置設定：React + Tailwind CSS
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
