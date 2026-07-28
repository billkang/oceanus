import { config } from 'dotenv';
import { resolve } from 'path';

// 在 NestJS ConfigModule 之前手动加载 .env，确保 Sentry.init 能读到环境变量
config({ path: resolve(__dirname, '../.env') });

// ⚠️ 必须保持在最前加载（import order 敏感）
// 确保 OTel instrumentation 在所有 logger 调用之前就绪
import './logging-otel';

import 'reflect-metadata';
import * as Sentry from '@sentry/node';

// 初始化 Sentry（兼容 GlitchTip）
if (process.env.GLITCHTIP_DSN) {
  Sentry.init({
    dsn: process.env.GLITCHTIP_DSN,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
    environment: process.env.NODE_ENV || 'development',
  });
  console.log('Sentry initialized');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import cluster from 'node:cluster';
import * as os from 'node:os';

const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED === 'true';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 使用 Pino 作为应用级日志记录器
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  app.setGlobalPrefix('api/v1');

  app.useGlobalFilters(app.get(AllExceptionsFilter));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('project')
    .setDescription('API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.PORT || 3100;
  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);

  // Worker 优雅退出
  if (CLUSTER_ENABLED && cluster.isWorker) {
    const shutdownTimeout = Number(process.env.WORKER_SHUTDOWN_TIMEOUT || 30);
    process.on('SIGTERM', async () => {
      logger.log(`Worker ${process.pid} shutting down gracefully (${shutdownTimeout}s timeout)`);
      const timeout = setTimeout(() => {
        logger.warn(`Worker ${process.pid} shutdown timeout, forcing exit`);
        process.exit(1);
      }, shutdownTimeout * 1000);
      await app.close();
      clearTimeout(timeout);
      process.exit(0);
    });
  }
}

// Cluster 模式入口
if (CLUSTER_ENABLED && cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  console.log(`Master process started, forking ${cpuCount} workers...`);

  for (let i = 0; i < cpuCount; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}), restarting...`);
    cluster.fork();
  });

  // Master 不做 NestJS 启动
} else {
  bootstrap();
}
