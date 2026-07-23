import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * 文件系统 SessionStore
 *
 * 将会话数据持久化到文件系统 JSONL 文件中。
 * 文件路径格式: {baseDir}/{projectKey}/{sessionId}.jsonl
 * 实现 SDK 的 SessionStore 接口用作镜像存储。
 */
export class FileSystemSessionStore implements SessionStore {
  constructor(private readonly baseDir: string) {}

  /** 会话文件路径 */
  private filePath(key: SessionKey): string {
    const subpath = key.subpath ? `-${key.subpath}` : '';
    const dir = path.join(this.baseDir, key.projectKey);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${key.sessionId}${subpath}.jsonl`);
  }

  /** 项目目录路径 */
  private projectDir(key: SessionKey): string {
    return path.join(this.baseDir, key.projectKey);
  }

  /**
   * 追加条目到 JSONL 文件
   */
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const filePath = this.filePath(key);
    const lines = entries.map((e) => JSON.stringify(e) + '\n').join('');
    fs.appendFileSync(filePath, lines, 'utf-8');
  }

  /**
   * 加载 JSONL 文件的所有条目
   */
  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const filePath = this.filePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  }

  /**
   * 列出项目下的所有会话
   */
  async listSessions(projectKey?: string): Promise<{ sessionId: string; mtime: number }[]> {
    const dir = projectKey
      ? path.join(this.baseDir, projectKey)
      : this.baseDir;

    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    return files.map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return {
        sessionId: file.replace(/\.jsonl$/, ''),
        mtime: stat.mtimeMs,
      };
    });
  }

  /**
   * 删除会话文件
   */
  async delete(key: SessionKey): Promise<void> {
    const filePath = this.filePath(key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
