import esbuild from 'esbuild'
import buildOptions from './esbuild.config.js'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'

// npm run dev passes --watch, npm run build does not
const isWatch = process.argv.includes('--watch')
const isFirefox = process.argv.includes('--firefox')
const browser = isFirefox ? 'firefox' : 'chrome'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// build/chrome/dist/ or build/firefox/dist/
const distDir = path.resolve(rootDir, 'build', browser, 'dist')

const FIREFOX_MANIFEST_PATCH = {
  background: {
    scripts: ['src/background.js'],
  },
  browser_specific_settings: {
    gecko: {
      id: 'revieu@alepisanu',
      strict_min_version: '109.0',
    },
  },
}

// esbuild only handles .ts files — static assets (manifest, HTML, CSS)
// need to be copied manually into dist/
const copyStaticFiles = () => {
  const staticFiles = [
    { from: 'manifest.json', to: 'manifest.json' },
    { from: 'popup/popup.html', to: 'popup/popup.html' },
    { from: 'src/ui/sidebar.css', to: 'src/ui/sidebar.css' },
    { from: 'icons/', to: 'icons/' },
    { from: 'assets/', to: 'assets/' },
  ]

  for (const file of staticFiles) {
    const src = path.join(rootDir, file.from)
    const dest = path.join(distDir, file.to)
    const destDir = path.dirname(dest)
    fs.mkdirSync(destDir, { recursive: true })

    if (fs.existsSync(src)) {
      const isDir = fs.statSync(src).isDirectory()
      if (isDir) {
        fs.cpSync(src, dest, { recursive: true })
      } else if (file.from === 'manifest.json' && isFirefox) {
        // Patch the manifest with Firefox-specific settings
        const manifest = JSON.parse(fs.readFileSync(src, 'utf8'))
        const patched = { ...manifest, ...FIREFOX_MANIFEST_PATCH }
        fs.writeFileSync(dest, JSON.stringify(patched, null, 2))
      } else {
        fs.copyFileSync(src, dest)
      }
    }
  }
}

const main = async () => {
  fs.mkdirSync(distDir, { recursive: true })
  copyStaticFiles()

  const target = isFirefox ? 'firefox109' : 'chrome120'
  const options = {
    ...buildOptions,
    outdir: distDir,
    target,
    define: { __FIREFOX__: isFirefox ? 'true' : 'false' },
  }

  if (isWatch) {
    const ctx = await esbuild.context(options)
    await ctx.watch()
    console.log(`Watching for changes... [${browser}]`)
  } else {
    await esbuild.build(options)
    console.log(`Build complete → build/${browser}/dist/`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
