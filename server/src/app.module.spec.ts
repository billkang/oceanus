import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { ChatService } from './chat/chat.service';

/**
 * DI 装配回归测试：编译完整 AppModule 必须成功，
 * 否则任何 provider 缺依赖（如 ChatService 需要 ProjectService）
 * 会抛出 UnknownDependenciesException——运行期才会暴露，
 * 单元测试用 TestingModule override 会掩盖此类接线错误。
 */
describe('AppModule DI wiring', () => {
  it('编译 AppModule 应成功且 ChatService 可解析', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    expect(moduleRef.get(ChatService)).toBeDefined();
  });
});
