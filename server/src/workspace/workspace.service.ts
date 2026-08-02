import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { WorkspacePathBuilder } from './workspace-path.builder';

/** 判断路径是否存在 */
async function fsExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 物理工作区服务：项目骨架 / 会话目录（含 skills symlink）/ 回收站 / 残留目录处理。
 * 目录路径一律经 WorkspacePathBuilder 产出。
 */
@Injectable()
export class WorkspaceService implements OnModuleInit {
  readonly paths: WorkspacePathBuilder;

  constructor(
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    const configured = configService.get<string>('PROJECTS_ROOT');
    const root = configured?.trim() ? configured : './projects';
    if (!configured?.trim()) {
      logger.warn('PROJECTS_ROOT 未配置，使用默认 ./projects');
    }
    this.paths = new WorkspacePathBuilder(root);
  }

  /** 启动时自动建工作区根目录 */
  async onModuleInit(): Promise<void> {
    await fsp.mkdir(this.paths.baseRoot, { recursive: true });
  }

  /** 创建项目骨架：requirements/shared/prd、requirements/private、repo（幂等） */
  async createSkeleton(projectName: string): Promise<void> {
    const dirs = [
      this.paths.sharedPrdDir(projectName),
      path.join(this.paths.requirementsRoot(projectName), 'private'),
      path.join(this.paths.projectRoot(projectName), 'repo'),
    ];
    for (const dir of dirs) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  /** 创建项目前置：项目根已有残留目录则移入回收站，失败抛错阻断创建（防止数据混入新项目） */
  async ensureFreshProjectDir(projectName: string): Promise<void> {
    const target = this.paths.projectRoot(projectName);
    if (await fsExists(target)) {
      await this.moveToTrash(target);
    }
  }

  /** 会话目录：mkdir + `.claude/skills` symlink → 项目根 skills（幂等） */
  async ensureSessionDir(projectName: string, username: string, sessionId: string): Promise<void> {
    const sessionDir = this.paths.sessionDir(projectName, username, sessionId);
    await fsp.mkdir(sessionDir, { recursive: true });

    const skillsLink = path.join(sessionDir, '.claude', 'skills');
    await fsp.mkdir(path.dirname(skillsLink), { recursive: true });
    let alreadyLink = false;
    try {
      const st = await fsp.lstat(skillsLink);
      alreadyLink = st.isSymbolicLink();
    } catch {
      alreadyLink = false;
    }
    if (!alreadyLink) {
      await fsp.symlink(this.paths.projectRoot(projectName) + '/.claude/skills', skillsLink, 'dir');
    }
  }

  /** 目录移入回收站（时间戳唯一，重名不覆盖，首用自动建 .trash/） */
  async moveToTrash(targetAbs: string): Promise<string> {
    await fsp.mkdir(this.paths.trashRoot(), { recursive: true });
    const name = path.basename(targetAbs);
    const dest = this.paths.trashPath(name);
    await fsp.rename(targetAbs, dest);
    this.logger.log(`Moved to trash: ${targetAbs} -> ${dest}`);
    return dest;
  }
}
