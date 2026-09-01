import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.module';
import { EditionConfig } from './config/edition.config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { SystemController, HealthController } from './controllers/system.controller';
import { ProjectResourceAccessPolicy } from './access/project-resource-access-policy';
import { AuditMutationInterceptor } from './interceptors/audit-mutation.interceptor';

const JWT_SECRET = process.env.LAUNCHLY_JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('LAUNCHLY_JWT_SECRET environment variable is required in production');
}

@Global()
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: JWT_SECRET || 'launchly-dev-secret-do-not-use-in-production',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [SystemController, HealthController],
  providers: [
    EditionConfig,
    ProjectResourceAccessPolicy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditMutationInterceptor },
  ],
  exports: [JwtModule, EditionConfig, PrismaModule, ProjectResourceAccessPolicy],
})
export class CommonModule {}
