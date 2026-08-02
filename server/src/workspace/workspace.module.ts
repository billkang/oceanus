import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

/**
 * 物理工作区模块：项目骨架 / 会话目录 / 回收站。
 * 导出 WorkspaceService 供 project / chat / session / archive 等模块使用。
 */
@Module({
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
