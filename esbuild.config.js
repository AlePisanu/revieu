import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isWatch = process.argv.includes('--watch')

const buildOptions = {
  // Each entry point becomes a separate bundle Chrome loads them independently
  entryPoints: [
    'src/content.ts',    // Injected into GitHub PR pages
    'src/background.ts', // Service worker for storage and messaging
    'popup/popup.ts',    // API key setup popup
  ],
  bundle: true,          // Inline all imports into each output file
  outdir: path.resolve(__dirname, 'dist'),
  platform: 'browser',
  target: 'chrome120',
  format: 'iife',        // Content scripts don't support ESM must use IIFE
  minify: !isWatch,      // Minify only in production
  sourcemap: isWatch,    // Sourcemaps only in dev for easier debugging
  logLevel: 'info',
}

export default buildOptions
