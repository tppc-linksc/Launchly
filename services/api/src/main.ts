import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.LAUNCHLY_PROCESS_ROLE === 'worker') {
    await NestFactory.createApplicationContext(AppModule);
    console.log('Launchly Worker running');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // CORS for development
  app.enableCors({
    origin: process.env.LAUNCHLY_CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.LAUNCHLY_APP_PORT || 8080;
  const webRoot = join(__dirname, 'web');
  app.useStaticAssets(webRoot, { redirect: false });
  await app.init();
  app.getHttpAdapter().get('*', (req, res) => {
    const request = req as any;
    const response = res as any;
    if (request.path.startsWith('/api')) return response.status(404).json({ statusCode: 404, message: 'Not Found' });
    response.sendFile(join(webRoot, 'index.html'));
  });
  await app.listen(port);
  console.log(`Launchly API running on :${port}`);
}
bootstrap();
