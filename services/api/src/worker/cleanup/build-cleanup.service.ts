import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';

const BUILD_ROOT = '/tmp/launchly-builds';

@Injectable()
export class BuildCleanupService {
  private readonly logger = new Logger(BuildCleanupService.name);
  private readonly maxAgeDays = parseInt(process.env.LAUNCHLY_CLEANUP_MAX_AGE_DAYS || '7');

  @Interval(3600000) // every hour
  cleanupOldBuilds() {
    if (!fs.existsSync(BUILD_ROOT)) return;

    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    try {
      const entries = fs.readdirSync(BUILD_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(BUILD_ROOT, entry.name);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.mtimeMs < cutoff) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            deleted++;
          }
        } catch (e: any) {
          this.logger.warn(`Failed to clean ${entry.name}: ${e.message}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to list build root: ${e.message}`);
    }

    if (deleted > 0) {
      this.logger.log(`Build cleanup: removed ${deleted} directories older than ${this.maxAgeDays} days`);
    }
  }
}
