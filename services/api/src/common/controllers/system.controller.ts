import { Controller, Get } from '@nestjs/common';
import { EditionConfig } from '../config/edition.config';
import { Public } from '../decorators/public.decorator';

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
  @Public()
  @Get()
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
