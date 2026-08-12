import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { WebhookService } from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Public()
  @Post('github')
  @HttpCode(202)
  async github(
    @Req() request: { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('x-github-delivery') deliveryId?: string,
    @Headers('x-github-event') event?: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const rawBody = request.rawBody || Buffer.from(JSON.stringify(body));
    return this.webhooks.receiveGithub({ deliveryId, event, signature, rawBody, body });
  }
}
