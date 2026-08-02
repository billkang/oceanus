/** Skills 安装器抽象类：向项目目录安装/检查 tide-* skills（作 DI token，interface 编译期被抹除） */
export abstract class SkillsProvider {
  /** 向项目目录安装 skills（含版本标记写入） */
  abstract install(projectDir: string): Promise<void>;
  /** 当前 CLI 内置 skills 版本 */
  abstract currentVersion(): Promise<string>;
  /** 项目内已安装版本是否过期（无标记视为过期） */
  abstract isOutdated(projectDir: string): Promise<boolean>;
}
