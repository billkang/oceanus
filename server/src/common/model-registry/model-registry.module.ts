import { Module } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';

/**
 * 模型注册表模块
 *
 * 提供 ModelRegistryService（多 provider 配置加载/解析/列表），供
 * AgentService 与 ChatController 注入。
 */
@Module({
  providers: [ModelRegistryService],
  exports: [ModelRegistryService],
})
export class ModelRegistryModule {}
