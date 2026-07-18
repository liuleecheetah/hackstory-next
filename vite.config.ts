import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Vite 建置設定：React + Tailwind CSS
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 相對路徑：讓建置結果放在 GitHub Pages 的子路徑（/hackstory/）也能正常載入
  base: './',
})
