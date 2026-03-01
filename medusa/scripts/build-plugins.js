#!/usr/bin/env node
/**
 * Automatically build and link all plugins from plugins/ directory.
 * Runs as postinstall — after `npm install` everything is ready.
 */
const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const pluginsDir = path.join(__dirname, "..", "plugins")
const nodeModules = path.join(__dirname, "..", "node_modules")

if (!fs.existsSync(pluginsDir)) process.exit(0)

const plugins = fs.readdirSync(pluginsDir).filter((d) => {
  const pkg = path.join(pluginsDir, d, "package.json")
  return fs.existsSync(pkg)
})

if (plugins.length === 0) process.exit(0)

const medusaBin = path.join(nodeModules, ".bin", "medusa")

for (const dir of plugins) {
  const pluginPath = path.join(pluginsDir, dir)
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginPath, "package.json"), "utf8"))
  const name = pkg.name

  console.log(`\n[build-plugins] Building ${name} ...`)

  try {
    // Install plugin deps (skip if node_modules exists)
    if (!fs.existsSync(path.join(pluginPath, "node_modules"))) {
      execSync("npm install --ignore-scripts", { cwd: pluginPath, stdio: "inherit" })
    }

    // Build: admin extensions + server code
    execSync(`${medusaBin} plugin:build`, { cwd: pluginPath, stdio: "inherit" })

    // Compile server TS (plugin:build may only compile admin extensions)
    const tscBin = path.join(nodeModules, ".bin", "tsc")
    if (fs.existsSync(path.join(pluginPath, "tsconfig.json"))) {
      execSync(`${tscBin} --project tsconfig.json`, { cwd: pluginPath, stdio: "inherit" })
    }

    // Link into node_modules
    const dest = path.join(nodeModules, name)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    fs.cpSync(path.join(pluginPath, "package.json"), path.join(dest, "package.json"))
    fs.cpSync(path.join(pluginPath, ".medusa"), path.join(dest, ".medusa"), { recursive: true })

    console.log(`[build-plugins] ${name} — OK`)
  } catch (err) {
    console.error(`[build-plugins] ${name} — FAILED: ${err.message}`)
    process.exit(1)
  }
}

console.log(`\n[build-plugins] All ${plugins.length} plugin(s) built and linked.`)
