import * as path from 'node:path';

/** 标识符非法：含路径分隔符、空串、空字符 */
const INVALID_RE = /[\\/]|^\s*$|\0/;

/** 路径穿越 / 非法标识符错误 */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

/** 校验标识符（projectName / username / sessionId）不允许路径穿越或空值 */
export function validateIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PathTraversalError(`${label} 为空`);
  }
  if (INVALID_RE.test(value) || value === '.' || value === '..') {
    throw new PathTraversalError(`${label} 含非法字符: "${value}"`);
  }
}

/**
 * 物理工作区路径统一构建器。
 * 服务内所有项目/会话/共享目录路径必须经本类产出，禁止手拼，防路径穿越。
 */
export class WorkspacePathBuilder {
  constructor(private readonly root: string) {}

  /** 工作区根目录（PROJECTS_ROOT） */
  get baseRoot(): string {
    return this.root;
  }

  /** 项目根目录 */
  projectRoot(projectName: string): string {
    validateIdentifier(projectName, 'projectName');
    return path.resolve(this.root, projectName);
  }

  /** 项目需求根目录 */
  requirementsRoot(projectName: string): string {
    return path.join(this.projectRoot(projectName), 'requirements');
  }

  /** 公共需求区（交互式 Agent 只读参考） */
  sharedRoot(projectName: string): string {
    return path.join(this.projectRoot(projectName), 'requirements', 'shared');
  }

  /** 共享 PRD 聚合目录 */
  sharedPrdDir(projectName: string): string {
    return path.join(this.sharedRoot(projectName), 'prd');
  }

  /** 会话专属目录（Agent cwd） */
  sessionDir(projectName: string, username: string, sessionId: string): string {
    validateIdentifier(username, 'username');
    validateIdentifier(sessionId, 'sessionId');
    return path.join(this.projectRoot(projectName), 'requirements', 'private', username, sessionId);
  }

  /** 回收站根目录 */
  trashRoot(): string {
    return path.resolve(this.root, '.trash');
  }

  /** 回收站目标路径（原名 + 时间戳，避免重名覆盖） */
  trashPath(originalName: string, timestamp = Date.now()): string {
    validateIdentifier(originalName, 'originalName');
    return path.join(this.trashRoot(), `${originalName}-${timestamp}`);
  }
}
