#!/usr/bin/env node
import { Command } from 'commander'

import { cmdInstall, cmdUp, cmdDown, cmdRestart } from './commands/install.js'
import { cmdUpgrade } from './commands/upgrade.js'
import { cmdUninstall } from './commands/uninstall.js'
import { cmdBackup } from './commands/backup.js'
import { cmdRestore } from './commands/restore.js'
import { cmdStatus, cmdLogs } from './commands/status.js'
import { cmdDoctor } from './commands/doctor.js'
import { cmdExec, cmdShell } from './commands/exec.js'

// ── CLI 入口（KI-041 / KI-042 修复后） ─────────────────────────────────────
// 本文件只负责把 commander 子命令与具体实现函数绑定；
// 实际逻辑分散在 cli/src/commands/ 下的各模块，并使用 execFileSync 接收
// 参数数组，避免把路径/用户输入拼入 shell 命令。

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
  .option('--force', '跳过确认提示')
  .action(cmdRestore)

program
  .command('uninstall')
  .description('卸载 Launchly')
  .option('--force', '跳过确认')
  .option('--keep-data', '保留数据目录和命名卷')
  .action(cmdUninstall)

program
  .command('exec <service> <command...>')
  .description('在指定服务容器内运行一次性命令')
  .action((service: string, command: string[], opts: unknown) => {
    // commander 会把剩余参数收集到 command
    void opts
    cmdExec(service, command)
  })

program
  .command('shell <service>')
  .description('进入指定服务容器的交互式 shell')
  .action(cmdShell)

program.parse()
