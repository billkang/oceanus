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
        transport: {
          targets: [
            // 开发环境：控制台美化输出
            ...(process.env.NODE_ENV !== 'production'
              ? [{
                  target: 'pino-pretty',
                  options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                  level: 'debug',
                }]
              : [{
                  target: 'pino/file',
                  options: { destination: 1 },
                  level: 'warn',
                }]
            ),
            // 始终写入文件
            {
              target: 'pino/file',
              options: { destination: './logs/combined.log', mkdir: true },
              level: 'info',
            },
          ],
        },
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
  ],
  controllers: [AppController],
  providers: [AppService, AllExceptionsFilter],
})
export class AppModule {}