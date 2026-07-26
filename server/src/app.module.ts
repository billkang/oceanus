import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LangfuseModule } from './common/langfuse/langfuse.module';
import { LoggingModule } from './common/logging/logging.module';
import { AgentModule } from './agent/agent.module';
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
    LoggingModule,
    AgentModule,
    AuthModule,
    ProjectModule,
    SessionModule,
    ChatModule,
    AssetModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, AllExceptionsFilter],
})
export class AppModule {}
