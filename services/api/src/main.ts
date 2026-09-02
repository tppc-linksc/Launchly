import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

/**
 * 应用入口：API 进程和 Worker 进程共用一个 AppModule，
 * 通过 LAUNCHLY_PROCESS_ROLE=worker 切换。
 *
 * 关键点：
 * - KI-011: CORS 解析独立成 resolveCorsConfig()，保证 wildcard 和 credentials 不会同时出现。
 * - 仅当 require.main === module 时启动 bootstrap；单测导入本文件不会拉起 HTTP 服务。
 */

/** CORS 配置：origin=true 表示反射任意来源；list 表示白名单。 */
export interface CorsConfig {
  origin: false | true | string[];
  credentials: boolean;
}

/**
 * 解析 CORS 配置。
 *
 * 规则：
 * - 未设置 / 空 → 禁用跨域，只允许同源调用。
 * - `*` → 反射任意来源，credentials 必须 false（CORS 规范禁止 * + credentials）。
 * - 显式列表 → 使用列表，credentials 允许为 true。
 *
 * 拆成纯函数以便单测覆盖（KI-011）。
 */
export function resolveCorsConfig(raw: string | undefined): CorsConfig {
  const value = raw?.trim();
  if (!value) return { origin: false, credentials: false };
  if (value === '*') {
    return { origin: true, credentials: false };
  }
  const list = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { origin: list, credentials: list.length > 0 };
}

async function bootstrap() {
  if (process.env.LAUNCHLY_PROCESS_ROLE === 'worker') {
    await NestFactory.createApplicationContext(AppModule);
    console.log('Launchly Worker running');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // KI-011: 用解析函数保证 CORS 配置合法。
  const cors = resolveCorsConfig(process.env.LAUNCHLY_CORS_ORIGIN);
  app.enableCors({
    origin: cors.origin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: cors.credentials,
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

// 仅当直接执行本文件时才启动；被 import 时（例如单测）不拉起 HTTP 服务。
if (require.main === module) {
  bootstrap();
}
