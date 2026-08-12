import { Module } from '@nestjs/common';
import { DeploymentModule } from '../deployment/deployment.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { GithubAppService } from './github-app.service';

@Module({
  imports: [DeploymentModule],
  controllers: [WebhookController],
  providers: [WebhookService, GithubAppService],
  exports: [GithubAppService],
})
export class GitModule {}
