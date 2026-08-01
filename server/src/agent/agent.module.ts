import { Module } from '@nestjs/common';
import { ModelRegistryModule } from '../common/model-registry/model-registry.module';
import { AgentService } from './agent.service';

@Module({
  imports: [ModelRegistryModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
