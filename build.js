import esbuild from 'esbuild'
import buildOptions from './esbuild.config.js'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as path from 'path'

// npm run dev passes --watch, npm run build does not
const isWatch = process.argv.includes('--watch')

// All output goes into dist/ — this is the folder loaded as unpacked extension in Chrome
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dist')

// esbuild only handles .ts files — static assets (manifest, HTML, CSS)
// need to be copied manually into dist/
const copyStaticFiles = () => {
  const staticFiles = [
    { from: 'manifest.json', to: 'manifest.json' },
    { from: 'popup/popup.html', to: 'popup/popup.html' },
    { from: 'src/ui/sidebar.css', to: 'src/ui/sidebar.css' },
    { from: 'icons/', to: 'icons/' },
  ]

  for (const file of staticFiles) {
    const dest = path.join(distDir, file.to)
    const destDir = path.dirname(dest)
    fs.mkdirSync(destDir, { recursive: true })

    if (fs.existsSync(file.from)) {
      const isDir = fs.statSync(file.from).isDirectory()
      if (isDir) {
        fs.cpSync(file.from, dest, { recursive: true })
      } else {
        fs.copyFileSync(file.from, dest)
      }
    }
  }
}

// Copy static files once, then either watch or build-and-exit
const main = async () => {
  fs.mkdirSync(distDir, { recursive: true })
  copyStaticFiles()

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await esbuild.build(buildOptions)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
