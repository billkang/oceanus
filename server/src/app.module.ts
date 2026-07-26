import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LangfuseModule } from './common/langfuse/langfuse.module';
import { LoggingModule } from './common/logging/logging.module';
import { AgentModule } from './agent/agent.module';
import { KeyPoolModule } from './common/key-pool/key-pool.module';
import { RequestQueueModule } from './common/queue/request-queue.module';
import { AuthModule } from './auth/auth.module';
import { ProjectModule } from './project/project.module';
import { SessionModule } from './session/session.module';
import { ChatModule } from './chat/chat.module';
import { AssetModule } from './asset/asset.module';
import { HealthModule } from './health/health.module';

/**
 * 应用根模块
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'global',
            ttl: 60000,
            limit: config.get('GLOBAL_RATE_LIMIT_LIMIT', 60),
          },
          {
            name: 'user',
            ttl: 60000,
            limit: config.get('USER_RATE_LIMIT_LIMIT', 5),
            getTracker: (req: Record<string, unknown>) => {
              const user = req.user as { id?: string | number } | undefined;
              return user?.id?.toString() ?? (req.ip as string);
            },
          },
        ],
        errorMessage: '请求过于频繁，请稍后重试',
      }),
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: () => crypto.randomUUID(),
        customAttributeKeys: {
          req: 'request',
          res: 'response',
          err: 'error',
        },
        serializers: {
          req: (req) => ({
            method: req.method,
            url: req.url,
            traceId: req.id,
          }),
          res: (res) => ({
            statusCode: res.statusCode,
          }),
        },
        ...(() => {
          // 解析日志级别
          const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
          const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
          const effectiveLevel = validLevels.includes(logLevel) ? logLevel : 'info';

          if (effectiveLevel !== logLevel) {
            console.warn(`Invalid LOG_LEVEL "${logLevel}", falling back to "info"`);
          }

          const target =
            process.env.NODE_ENV !== 'production'
              ? {
                  target: 'pino-pretty',
                  options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                  level: effectiveLevel,
                }
              : {
                  target: 'pino/file',
                  options: { destination: 1 },
                  level: effectiveLevel,
                };

          return { transport: { targets: [target] } };
        })(),
      },
    }),
    PrismaModule,
    LangfuseModule,
    KeyPoolModule,
    LoggingModule,
    AgentModule,
    AuthModule,
    ProjectModule,
    SessionModule,
    ChatModule,
    AssetModule,
    HealthModule,
    RequestQueueModule,
  ],
  controllers: [AppController],
  providers: [AppService, AllExceptionsFilter],
})
export class AppModule {}
