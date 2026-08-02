import { Module } from '@nestjs/common';
import { DeepstormSkillsProvider } from './deepstorm-skills.provider';
import { SkillsProvider } from './skills-provider.interface';

/**
 * Skills 模块：提供 SkillsProvider（DeepstormSkillsProvider 实现）。
 * 导出 SkillsProvider 供 project（安装）/ chat（惰性刷新）消费。
 */
@Module({
  providers: [{ provide: SkillsProvider, useClass: DeepstormSkillsProvider }],
  exports: [SkillsProvider],
})
export class SkillsModule {}
