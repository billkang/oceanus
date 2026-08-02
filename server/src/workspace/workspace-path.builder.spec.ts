import { describe, expect, it } from 'vitest';
import { PathTraversalError, WorkspacePathBuilder } from './workspace-path.builder';

describe('WorkspacePathBuilder', () => {
  const root = '/tmp/projects';
  const b = new WorkspacePathBuilder(root);

  it('构建会话目录 / 共享 PRD / 回收站路径', () => {
    expect(b.sessionDir('proj', 'alice', 'sess-1')).toBe('/tmp/projects/proj/requirements/private/alice/sess-1');
    expect(b.sharedPrdDir('proj')).toBe('/tmp/projects/proj/requirements/shared/prd');
    expect(b.trashPath('proj', 1000)).toBe('/tmp/projects/.trash/proj-1000');
  });

  it('非法标识符抛 PathTraversalError', () => {
    expect(() => b.projectRoot('../evil')).toThrow(PathTraversalError);
    expect(() => b.projectRoot('a/b')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', '..', 's1')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', 'alice', 's\\x')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', 'alice', '')).toThrow(PathTraversalError);
  });
});
