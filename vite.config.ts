import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { builtinModules } from 'module'
import path from 'path'

// 主进程需外部化的运行时依赖：含动态 require / 读取自身资源，不能被 esbuild 打进 main.js，
// 由 electron-builder 以生产依赖纳入包内。
const electronExternals = [
  'electron',
  'electron-updater',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

export default defineConfig({
  plugins: [
    { name: 'development-csp', transformIndexHtml(html, context) { return context.server ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") : html } },
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: electronExternals,
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: { rollupOptions: { output: { manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'], motion: ['framer-motion'] } } } },
  server: {
    port: 5173,
  },
})
