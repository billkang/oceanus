import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ArchiveService } from './archive.service';

/**
 * 归档合并模块：PRD 去抖触发 + LLM 域归并，供 chat 等模块触发归档。
 */
@Module({
  imports: [WorkspaceModule],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
