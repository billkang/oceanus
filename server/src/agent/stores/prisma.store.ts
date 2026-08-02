import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Prisma 版 SessionStore
 *
 * 分区键 partitionKey = `${projectName}/${username}`，构造时固化。
 * 忽略 SDK 传入的 key.projectKey（cwd-derived），保证 (项目 × 用户) 物理隔离。
 * 表结构由 Prisma `SessionEntry` 模型管理（prisma migrate），不引入独立数据库客户端。
 */
export class PrismaSessionStore implements SessionStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partitionKey: string,
  ) {}

  /** 镜像一批会话条目：每个 entry 一行，带 uuid 幂等去重 */
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const existing = new Set<string>();
    const uuids = entries.map((e) => e.uuid).filter((u): u is string => Boolean(u));
    if (uuids.length > 0) {
      const dupes = await this.prisma.sessionEntry.findMany({
        where: { partitionKey: this.partitionKey, sessionId: key.sessionId, uuid: { in: uuids }, deletedAt: null },
        select: { uuid: true },
      });
      dupes.forEach((d) => {
        if (d.uuid) existing.add(d.uuid);
      });
    }
    const fresh = entries.filter((e) => !(e.uuid && existing.has(e.uuid)));
    if (fresh.length === 0) return;
    await this.prisma.sessionEntry.createMany({
      data: fresh.map((e) => ({
        partitionKey: this.partitionKey,
        sessionId: key.sessionId,
        subpath: key.subpath ?? null,
        uuid: e.uuid ?? null,
        entry: e as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  /** 加载整个会话（resume 用），无记录返回 null；已软删记录不可见 */
  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const rows = await this.prisma.sessionEntry.findMany({
      where: {
        partitionKey: this.partitionKey,
        sessionId: key.sessionId,
        subpath: key.subpath ?? null,
        deletedAt: null,
      },
      orderBy: { id: 'asc' },
      select: { entry: true },
    });
    return rows.length > 0 ? rows.map((r) => r.entry as unknown as SessionStoreEntry) : null;
  }

  /** 列出分区下所有主会话（subpath 为 null），按最后写入时间倒序；不含已软删 */
  async listSessions(_projectKey?: string): Promise<{ sessionId: string; mtime: number }[]> {
    const grouped = await this.prisma.sessionEntry.groupBy({
      by: ['sessionId'],
      where: { partitionKey: this.partitionKey, subpath: null, deletedAt: null },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });
    return grouped.map((g) => ({
      sessionId: g.sessionId,
      mtime: g._max.createdAt?.getTime() ?? 0,
    }));
  }

  /** 删除会话（软删）：subpath 未定义删主记录（级联子路径），有值仅删该子路径 */
  async delete(key: SessionKey): Promise<void> {
    const where =
      key.subpath === undefined
        ? { partitionKey: this.partitionKey, sessionId: key.sessionId }
        : { partitionKey: this.partitionKey, sessionId: key.sessionId, subpath: key.subpath };
    await this.prisma.sessionEntry.updateMany({ where, data: { deletedAt: new Date() } });
  }

  /** 列出会话下所有子路径；不含已软删 */
  async listSubkeys(key: SessionKey): Promise<string[]> {
    const rows = await this.prisma.sessionEntry.findMany({
      where: { partitionKey: this.partitionKey, sessionId: key.sessionId, NOT: { subpath: null }, deletedAt: null },
      distinct: ['subpath'],
      select: { subpath: true },
    });
    return rows.map((r) => r.subpath).filter((s): s is string => typeof s === 'string');
  }
}
