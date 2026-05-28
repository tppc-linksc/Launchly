import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.module';
import { EditionConfig } from './config/edition.config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { SystemController, HealthController } from './controllers/system.controller';

@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.LAUNCHLY_JWT_SECRET || 'launchly-dev-secret-do-not-use-in-production',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [SystemController, HealthController],
  providers: [
    EditionConfig,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [JwtModule, EditionConfig, PrismaModule],
})
export class CommonModule {}
