import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { EditionConfig } from '../config/edition.config';
import { Public } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('system')
export class SystemController {
  constructor(private readonly editionConfig: EditionConfig) {}

  @Public()
  @Get('info')
  info() {
    return {
      edition: this.editionConfig.getEdition(),
      isCloud: this.editionConfig.isCloud(),
      version: '0.2.0',
    };
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ok', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'unavailable' });
    }
  }
}
