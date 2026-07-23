import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileSystemSessionStore } from './file-system.store';
import type { SessionKey } from '@anthropic-ai/claude-agent-sdk';

describe('FileSystemSessionStore', () => {
  let store: FileSystemSessionStore;
  let testDir: string;

  const p1s1: SessionKey = { projectKey: 'project-1', sessionId: 'session-uuid-1' };
  const p1s2: SessionKey = { projectKey: 'project-1', sessionId: 'session-uuid-2' };
  const p2s3: SessionKey = { projectKey: 'project-2', sessionId: 'session-uuid-3' };
  const p1Delete: SessionKey = { projectKey: 'project-1', sessionId: 'to-delete' };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oceanus-store-test-'));
    store = new FileSystemSessionStore(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('append and load', () => {
    it('应追加条目并加载回来', async () => {
      const entries = [
        { type: 'user', uuid: 'e1', content: 'hello', timestamp: new Date().toISOString() },
        { type: 'assistant', uuid: 'e2', content: 'hi', timestamp: new Date().toISOString() },
      ];

      await store.append(p1s1, entries);
      const loaded = await store.load(p1s1);

      expect(loaded).toHaveLength(2);
      expect(loaded![0]).toMatchObject({ uuid: 'e1', content: 'hello' });
      expect(loaded![1]).toMatchObject({ uuid: 'e2', content: 'hi' });
    });

    it('不存在的 key 应返回 null', async () => {
      const result = await store.load({ projectKey: 'nonexistent', sessionId: 'nope' });
      expect(result).toBeNull();
    });

    it('应追加到已有条目', async () => {
      await store.append(p1s2, [{ type: 'user', uuid: 'e1', content: 'first' }]);
      await store.append(p1s2, [{ type: 'assistant', uuid: 'e2', content: 'second' }]);

      const loaded = await store.load(p1s2);
      expect(loaded).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('应删除会话', async () => {
      await store.append(p1Delete, [{ type: 'user', uuid: 'e1', content: 'test' }]);
      expect(await store.load(p1Delete)).not.toBeNull();

      await store.delete(p1Delete);
      expect(await store.load(p1Delete)).toBeNull();
    });

    it('删除不存在的 key 不应抛异常', async () => {
      await expect(
        store.delete({ projectKey: 'not-exist', sessionId: 'nope' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('应列出项目下的会话', async () => {
      await store.append(p1s1, [{ type: 'user', uuid: 'a1', content: 'test' }]);
      await store.append(p1s2, [{ type: 'user', uuid: 'b1', content: 'test' }]);
      await store.append(p2s3, [{ type: 'user', uuid: 'c1', content: 'test' }]);

      const sessions = await store.listSessions('project-1');
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId).sort()).toEqual([
        'session-uuid-1',
        'session-uuid-2',
      ]);
    });

    it('空项目应返回空数组', async () => {
      const sessions = await store.listSessions('project-empty');
      expect(sessions).toEqual([]);
    });
  });
});
