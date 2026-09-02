import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RunnerContext, RunnerResult } from './runner.factory';
import { buildContextDir } from './build-context';

/** Creates source only for reviewed, versioned built-in templates. Never executes user supplied template text. */
@Injectable()
export class TemplateSourceRunner {
  async execute(ctx: RunnerContext): Promise<RunnerResult> {
    if (ctx.payload.templateId !== 'static-blog')
      return this.failure('Template is not supported by the deployment executor');
    let workDir: string;
    try {
      workDir = buildContextDir(ctx.refId);
    } catch (error: any) {
      return this.failure(error?.message || 'Invalid refId');
    }
    const title = this.escapeHtml(String(ctx.payload.templateTitle || 'Launchly Blog').slice(0, 120));
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(workDir, 'Dockerfile'),
        'FROM nginx:1.27-alpine\nCOPY index.html /usr/share/nginx/html/index.html\nEXPOSE 80\n',
        { mode: 0o600 },
      );
      fs.writeFileSync(path.join(workDir, 'index.html'), this.html(title), { mode: 0o600 });
      await ctx.stageLogCallback?.('RUNNING', 'Created reviewed static-blog template source');
      return { success: true, stdout: 'Template source created', stderr: '', exitCode: 0, errorMessage: '' };
    } catch (error: any) {
      return this.failure(error?.message || 'Unable to create template source');
    }
  }

  private html(title: string) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{max-width:720px;margin:12vh auto;padding:0 24px;font:18px/1.7 system-ui;color:#172033}small{color:#64748b}</style></head><body><small>由 Launchly 静态博客模板部署</small><h1>${title}</h1><p>这里是你的第一篇文章。将内容接入 Git 静态站点后，每次推送都会生成新的不可变制品。</p></body></html>`;
  }
  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  }
  private failure(message: string): RunnerResult {
    return { success: false, stdout: '', stderr: message, exitCode: -1, errorMessage: message };
  }
}
