import { Global, Module } from '@nestjs/common';
import { LangfuseService } from './langfuse.service';

/**
 * Langfuse 可观测性模块
 *
 * 全局模块，导出 LangfuseService 供全应用使用。
 * LangfuseService 在 onModuleInit 中根据 LANGFUSE_BASE_URL 环境变量
 * 决定是否初始化 Langfuse 客户端。
 */
@Global()
@Module({
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class LangfuseModule {}
