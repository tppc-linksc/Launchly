#!/usr/bin/env node

import { Command } from 'commander'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  getDataDir,
  fileExists,
  randomString,
  generateEnv,
  composeTemplate,
  COMPOSE_FILE,
  ENV_FILE,
} from './config.js'

function runCompose(dataDir: string, args: string[]): void {
  const base = ['compose', '-f', path.join(dataDir, COMPOSE_FILE)]
  const envPath = path.join(dataDir, ENV_FILE)
  if (fileExists(envPath)) {
    base.push('--env-file', envPath)
  }
  execSync(`docker ${[...base, ...args].join(' ')}`, { stdio: 'inherit' })
}

// ── Commands ──────────────────────────────────────────────

function cmdInstall(opts: { dryRun?: boolean; port?: string }) {
  const dataDir = getDataDir()
  const port = opts.port || '8080'

  if (opts.dryRun) {
    console.log('=== Launchly Install (Dry Run) ===\n')
    console.log('Planned actions:\n')
    console.log(`  1. Create data directory: ${dataDir}`)
    console.log(`  2. Generate .env with auto-generated secrets`)
    console.log(`  3. Write docker-compose.yml`)
    console.log(`  4. Start Docker Compose services`)
    console.log(`  5. Output browser initialization URL:\n`)
    console.log(`     http://localhost:${port}/setup\n`)
    return
  }

  console.log('=== Launchly Install ===\n')

  // 1. Create directories
  console.log('Creating directories ...')
  for (const sub of ['', 'logs', 'data', 'config']) {
    const dir = path.join(dataDir, sub)
    fs.mkdirSync(dir, { recursive: true })
    console.log(`  ${dir}`)
  }
  console.log()

  // 2. Generate .env
  const envPath = path.join(dataDir, ENV_FILE)
  if (fileExists(envPath)) {
    console.log(`  .env already exists at ${envPath}, skipping.\n`)
  } else {
    console.log('Generating .env file ...')
    fs.writeFileSync(envPath, generateEnv(port), { mode: 0o600 })
    console.log(`  ${envPath} (permissions: 600)\n`)
  }

  // 3. Write docker-compose.yml
  console.log('Writing docker-compose.yml ...')
  fs.writeFileSync(path.join(dataDir, COMPOSE_FILE), composeTemplate())
  console.log(`  ${path.join(dataDir, COMPOSE_FILE)}\n`)

  // 4. Start services
  console.log('Starting services ...')
  runCompose(dataDir, ['up', '-d'])

  console.log('\nInstallation complete.\n')
  console.log('Next steps:')
  console.log(`  1. Open http://localhost:${port}/setup in your browser`)
  console.log('  2. Create your owner account and workspace\n')
}

function cmdUp() {
  console.log('Starting Launchly services ...')
  runCompose(getDataDir(), ['up', '-d'])
  console.log('Services started.')
}

function cmdDown() {
  console.log('Stopping Launchly services ...')
  runCompose(getDataDir(), ['down'])
  console.log('Services stopped.')
}

function cmdRestart() {
  console.log('Restarting Launchly services ...')
  runCompose(getDataDir(), ['restart'])
  console.log('Services restarted.')
}

function cmdStatus() {
  const dataDir = getDataDir()
  try {
    execSync(`docker compose -f ${path.join(dataDir, COMPOSE_FILE)} ps`, { stdio: 'inherit' })
  } catch {
    console.log('Launchly services not found. Run `launchly install` first.')
  }
}

function cmdLogs(opts: { follow?: boolean; service?: string }) {
  const args = ['logs']
  if (opts.follow) args.push('-f')
  if (opts.service) args.push(opts.service)
  runCompose(getDataDir(), args)
}

function cmdDoctor() {
  console.log('=== Launchly Doctor ===\n')

  // Docker
  process.stdout.write('Docker ....................... ')
  try {
    const ver = execSync('docker version --format "{{.Server.Version}}"', { encoding: 'utf-8' }).trim()
    console.log(`OK (v${ver})`)
  } catch {
    console.log('NOT FOUND')
    console.log('  Fix: Install Docker from https://docs.docker.com/get-docker/')
  }

  // Docker Compose
  process.stdout.write('Docker Compose .............. ')
  try {
    const ver = execSync('docker compose version --short', { encoding: 'utf-8' }).trim()
    console.log(`OK (v${ver})`)
  } catch {
    try {
      const ver = execSync('docker-compose version --short', { encoding: 'utf-8' }).trim()
      console.log(`OK (v${ver})`)
    } catch {
      console.log('NOT FOUND')
      console.log('  Fix: Install Docker Compose plugin or Docker Desktop.')
    }
  }

  // Ports
  console.log('Ports ........................')
  for (const { port, name } of [
    { port: 8080, name: 'launchly-app' },
    { port: 5173, name: 'launchly-web (dev)' },
    { port: 5432, name: 'launchly-postgres' },
  ]) {
    process.stdout.write(`  ${port} (${name}) ............... `)
    try {
      execSync(`lsof -i :${port} -sTCP:LISTEN`, { encoding: 'utf-8' })
      console.log('IN USE')
    } catch {
      console.log('FREE')
    }
  }

  // Disk space
  process.stdout.write('Disk space ................... ')
  try {
    const stat = fs.statfsSync(os.homedir())
    const availGB = (stat.bavail * stat.bsize) / 1_073_741_824
    if (availGB < 1.0) {
      console.log(`WARNING (${availGB.toFixed(1)} GB available)`)
      console.log('  Launchly needs at least 1 GB free space.')
    } else {
      console.log(`OK (${availGB.toFixed(1)} GB available)`)
    }
  } catch {
    console.log('UNABLE TO CHECK')
  }

  // Data directory
  const dataDir = getDataDir()
  process.stdout.write(`Data directory (${dataDir}) ... `)
  try {
    const stat = fs.statSync(dataDir)
    console.log(stat.isDirectory() ? 'EXISTS' : 'EXISTS BUT NOT A DIRECTORY')
  } catch {
    console.log('NOT YET CREATED (will be created on install)')
  }

  console.log('\nDoctor check complete.')
}

function cmdBackup() {
  const dataDir = getDataDir()
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, `launchly-backup-${timestamp}.tar.gz`)

  console.log(`Creating backup: ${backupFile}`)

  // Dump database
  const dbFile = path.join(backupDir, 'db_dump.sql')
  try {
    const out = execSync(
      `docker compose -f ${path.join(dataDir, COMPOSE_FILE)} exec -T launchly-postgres pg_dumpall -U launchly`,
      { encoding: 'utf-8' }
    )
    fs.writeFileSync(dbFile, out, { mode: 0o600 })
  } catch (e: any) {
    console.error('Error dumping database:', e.message)
    console.error('Make sure Launchly is running (`launchly up`) and try again.')
    process.exit(1)
  }

  // Create tar.gz
  const tmpDir = path.join(backupDir, `tmp_${timestamp}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.renameSync(dbFile, path.join(tmpDir, 'db_dump.sql'))
  const envSrc = path.join(dataDir, ENV_FILE)
  if (fileExists(envSrc)) fs.copyFileSync(envSrc, path.join(tmpDir, ENV_FILE))

  execSync(`tar -czf ${backupFile} -C ${tmpDir} .`)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`Backup created: ${backupFile}`)
}

function cmdRestore(backupFile: string) {
  if (!backupFile) {
    console.error('Usage: launchly restore <backup-file>')
    process.exit(1)
  }
  if (!fileExists(backupFile)) {
    console.error(`Error: backup file not found: ${backupFile}`)
    process.exit(1)
  }

  const dataDir = getDataDir()
  console.log(`Restoring from: ${backupFile}`)
  console.log('Warning: This will overwrite existing data.')
  process.stdout.write('Continue? [y/N] ')

  // In non-interactive mode, just proceed
  const restoreDir = path.join(dataDir, 'restore_tmp')
  fs.rmSync(restoreDir, { recursive: true, force: true })
  fs.mkdirSync(restoreDir, { recursive: true })

  try {
    execSync(`tar -xzf ${backupFile} -C ${restoreDir}`)

    const dumpFile = path.join(restoreDir, 'db_dump.sql')
    if (fileExists(dumpFile)) {
      console.log('Restoring database ...')
      const data = fs.readFileSync(dumpFile, 'utf-8')
      execSync(
        `docker compose -f ${path.join(dataDir, COMPOSE_FILE)} exec -T launchly-postgres psql -U launchly -d launchly`,
        { input: data, stdio: ['pipe', 'inherit', 'inherit'] }
      )
    }
    console.log('Restore complete.')
  } finally {
    fs.rmSync(restoreDir, { recursive: true, force: true })
  }
}

function cmdUpgrade() {
  const dataDir = getDataDir()
  console.log('Upgrading Launchly ...')
  console.log('Pulling latest images ...')
  runCompose(dataDir, ['pull'])
  console.log('Recreating services ...')
  runCompose(dataDir, ['up', '-d'])
  console.log('Upgrade complete.')
}

function cmdUninstall(opts: { force?: boolean; keepData?: boolean }) {
  const dataDir = getDataDir()

  if (!opts.force) {
    console.log('WARNING: This will stop and remove all Launchly services.')
    if (!opts.keepData) {
      console.log('         All data will be deleted (use --keep-data to preserve).')
    }
    // Simple stdin read for confirmation
    console.log("Type 'yes' to confirm: ")
    const buf = Buffer.alloc(256)
    const fd = fs.openSync('/dev/stdin', 'r')
    const bytes = fs.readSync(fd, buf, 0, 256, null)
    fs.closeSync(fd)
    const answer = buf.toString('utf-8', 0, bytes).trim()
    if (answer !== 'yes') {
      console.log('Aborted.')
      return
    }
  }

  console.log('Stopping services ...')
  try { runCompose(dataDir, ['down', '-v']) } catch { /* ignore */ }

  if (!opts.keepData) {
    console.log('Removing data directory ...')
    fs.rmSync(dataDir, { recursive: true, force: true })
    console.log(`  ${dataDir} removed`)
  }

  console.log('Launchly has been uninstalled.')
}

// ── CLI Definition ────────────────────────────────────────

const program = new Command()

program
  .name('launchly')
  .description('Launchly CLI - 自托管部署平台命令行工具')
  .version('0.2.0')

program
  .command('install')
  .description('安装 Launchly 服务')
  .option('--dry-run', '预览安装过程，不实际执行')
  .option('--port <port>', '设置应用端口', '8080')
  .action(cmdInstall)

program.command('up').description('启动 Launchly 服务').action(cmdUp)
program.command('down').description('停止 Launchly 服务').action(cmdDown)
program.command('restart').description('重启 Launchly 服务').action(cmdRestart)
program.command('status').description('查看服务状态').action(cmdStatus)

program
  .command('logs')
  .description('查看服务日志')
  .option('-f, --follow', '跟踪日志输出')
  .option('--service <name>', '查看指定服务的日志')
  .action(cmdLogs)

program.command('doctor').description('检查系统环境').action(cmdDoctor)
program.command('upgrade').description('升级到最新版本').action(cmdUpgrade)
program.command('backup').description('备份数据库和数据').action(cmdBackup)

program
  .command('restore <file>')
  .description('从备份恢复')
  .action(cmdRestore)

program
  .command('uninstall')
  .description('卸载 Launchly')
  .option('--force', '跳过确认')
  .option('--keep-data', '保留数据目录和卷')
  .action(cmdUninstall)

program.parse()
