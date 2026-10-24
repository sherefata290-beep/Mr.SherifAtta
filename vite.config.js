import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function existingPath(...candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }
  return null
}

export default defineConfig(async ({ mode }) => {
  const plugins = [react(), tailwindcss()]
  try {
    const m = await import('./.vite-source-tags.js')
    plugins.push(m.sourceTags())
  } catch {
    /* optional local plugin — may be missing babel deps on some hosts */
  }

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_'])
  const processEnvDefines = {}
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value)
  }

  // Fallbacks for incomplete shared installs in the sandbox.
  // On Vercel, packages resolve normally from node_modules.
  const alias = {}
  const pairs = [
    ['dompurify', ['node_modules/dompurify', '/tmp/em-node/node_modules/dompurify']],
    ['jspdf', ['node_modules/jspdf', '/tmp/em-node/node_modules/jspdf']],
    ['jspdf-autotable', ['node_modules/jspdf-autotable', '/tmp/em-node/node_modules/jspdf-autotable']],
    ['html2canvas', ['node_modules/html2canvas', '/tmp/em-node/node_modules/html2canvas']],
    ['canvg', ['node_modules/canvg', '/tmp/em-node/node_modules/canvg']],
    ['core-js', ['node_modules/core-js', '/tmp/em-node/node_modules/core-js']],
  ]
  for (const [name, rels] of pairs) {
    const found = existingPath(...rels.map((r) => (path.isAbsolute(r) ? r : path.resolve(__dirname, r))))
    if (found) alias[name] = found
  }

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: processEnvDefines,
    resolve: { alias },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules') && !id.includes('vendor')) return
            if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('jspdf-autotable')) {
              return 'export-vendor'
            }
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('framer-motion')) return 'motion'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('react-dom') || id.includes('react-router') || id.includes('/react/')) {
              return 'react-vendor'
            }
          },
        },
      },
    },
  }
})
