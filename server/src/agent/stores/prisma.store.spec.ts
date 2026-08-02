import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaSessionStore } from './prisma.store';

// 独立分区键隔离 conformance 测试数据
const P = 'test/conformance/tester';

describe('PrismaSessionStore', () => {
  const prisma = new PrismaService(undefined as never);
  const store = new PrismaSessionStore(prisma, P);

  beforeAll(async () => {
    await prisma.$connect();
    // 清理本分区残留，保证幂等
    await prisma.sessionEntry.deleteMany({ where: { partitionKey: P } });
  });
  afterAll(async () => {
    await prisma.sessionEntry.deleteMany({ where: { partitionKey: P } });
    await prisma.$disconnect();
  });

  it('append 后 load 返回同序 entry', async () => {
    const key = { projectKey: P, sessionId: 's1' };
    await store.append(key, [
      { type: 'user', uuid: 'u1', message: 'hi' },
      { type: 'assistant', uuid: 'a1', message: 'yo' },
    ]);
    const loaded = await store.load(key);
    expect(loaded).toHaveLength(2);
    expect(loaded![0].uuid).toBe('u1');
    expect(loaded![1].uuid).toBe('a1');
  });

  it('无记录 load 返回 null', async () => {
    expect(await store.load({ projectKey: P, sessionId: 'missing' })).toBeNull();
  });

  it('uuid 重复 append 去重', async () => {
    const key = { projectKey: P, sessionId: 's2' };
    await store.append(key, [{ type: 'user', uuid: 'dup' }]);
    await store.append(key, [{ type: 'user', uuid: 'dup' }]);
    expect(await store.load(key)).toHaveLength(1);
  });

  it('listSessions 按 mtime 倒序', async () => {
    const keyA = { projectKey: P, sessionId: 'sa' };
    const keyB = { projectKey: P, sessionId: 'sb' };
    await store.append(keyA, [{ type: 'user', message: 'a' }]);
    await new Promise((r) => setTimeout(r, 30));
    await store.append(keyB, [{ type: 'user', message: 'b' }]);
    const list = await store.listSessions(P);
    expect(list[0].sessionId).toBe('sb');
    expect(list[1].sessionId).toBe('sa');
  });

  it('delete 软删：记录保留但读查询不可见（deletedAt 置位）', async () => {
    const key = { projectKey: P, sessionId: 'soft-del' };
    await store.append(key, [{ type: 'user', uuid: 'sd1' }]);

    await store.delete(key);

    // 读路径（load / listSessions）不可见
    expect(await store.load(key)).toBeNull();
    const sessions = await store.listSessions(P);
    expect(sessions.map((s) => s.sessionId)).not.toContain('soft-del');
    // 记录仍物理存在（软删语义），deletedAt 已置位
    const rows = await prisma.sessionEntry.findMany({ where: { partitionKey: P, sessionId: 'soft-del' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
  });

  it('delete 主记录级联子路径，listSubkeys 返回子路径', async () => {
    const key = { projectKey: P, sessionId: 's3' };
    const sub = { projectKey: P, sessionId: 's3', subpath: 'subagents/agent-1' };
    await store.append(key, [{ type: 'user', uuid: 'm' }]);
    await store.append(sub, [{ type: 'assistant', uuid: 'm2' }]);
    expect(await store.listSubkeys(key)).toEqual(['subagents/agent-1']);
    await store.delete(key);
    expect(await store.load(key)).toBeNull();
    expect(await store.load(sub)).toBeNull();
  });
});
