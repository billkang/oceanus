import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AgentModule } from '../agent/agent.module';
import { SessionModule } from '../session/session.module';
import { AssetModule } from '../asset/asset.module';
import { AuthModule } from '../auth/auth.module';
import { ProjectModule } from '../project/project.module';
import { ModelRegistryModule } from '../common/model-registry/model-registry.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SkillsModule } from '../skills/skills.module';
import { ArchiveModule } from '../archive/archive.module';

@Module({
  imports: [
    AgentModule,
    SessionModule,
    AssetModule,
    AuthModule,
    ProjectModule,
    ModelRegistryModule,
    WorkspaceModule,
    SkillsModule,
    ArchiveModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
