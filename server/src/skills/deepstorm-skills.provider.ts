import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { SkillsProvider } from './skills-provider.interface';

/** 版本标记文件名（位于 .claude/skills/ 下） */
const VERSION_MARKER_REL = path.join('.claude', 'skills', '.deepstorm-skills.json');
/** 待复制的 skill 模板目录名 */
const TIDE_SKILLS = ['tide-discuss', 'tide-publish'] as const;

interface VersionMarker {
  installedVersion: string;
  installedAt: string;
}

/** 递归复制目录（cp -r 等价） */
async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

/**
 * DeepStorm skills 安装器。
 * 从 `@deepstorm/cli` 内置的 `dist/skills/tide-*` 模板复制到项目 `.claude/skills/`，
 * 并写入版本标记（`.deepstorm-skills.json`）供惰性刷新判断。
 *
 * 注：不 spawn `deepstorm setup`——其写入面含 settings.json / hooks / agents / .deepstorm，
 * 与交互式 Agent 的写白名单 + 去 Bash 隔离冲突（见 design.md OQ-3）。
 */
@Injectable()
export class DeepstormSkillsProvider extends SkillsProvider {
  private readonly installTimeoutMs: number;

  constructor(
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    super();
    const raw = configService.get<number>('SKILLS_INSTALL_TIMEOUT_MS');
    this.installTimeoutMs = typeof raw === 'number' && raw > 0 ? raw : 60000;
  }

  /** 解析 CLI 包内 skills 模板根目录 */
  private static skillsTemplateRoot(): string {
    const pkgPath = require.resolve('@deepstorm/cli/package.json');
    return path.join(path.dirname(pkgPath), 'dist', 'skills');
  }

  /** 安装：复制 tide-* 模板 + 重命名 .tmpl + 写版本标记，带超时兜底（调用方 catch 记录日志，惰性刷新补装） */
  async install(projectDir: string): Promise<void> {
    await withTimeout(
      this.doInstall(projectDir),
      this.installTimeoutMs,
      `tide-* skills 安装超时（>${this.installTimeoutMs}ms）`,
    );
  }

  /** 实际安装流程（提取以便 install 超时包裹，IO 卡死时不再无限等待） */
  private async doInstall(projectDir: string): Promise<void> {
    const templateRoot = DeepstormSkillsProvider.skillsTemplateRoot();
    const skillsDir = path.join(projectDir, '.claude', 'skills');
    await fsp.mkdir(skillsDir, { recursive: true });

    for (const skill of TIDE_SKILLS) {
      const src = path.join(templateRoot, skill);
      const dest = path.join(skillsDir, skill);
      await copyDir(src, dest);
      // .tmpl 模板渲染：SKILL.md.tmpl → SKILL.md（无变量替换，纯重命名）
      const tmpl = path.join(dest, 'SKILL.md.tmpl');
      const md = path.join(dest, 'SKILL.md');
      try {
        await fsp.access(tmpl);
        await fsp.rename(tmpl, md);
      } catch {
        // 无 .tmpl 文件则跳过（目录结构变化时容错）
      }
    }

    await this.writeVersionMarker(projectDir);
    this.logger.log(`tide-* skills installed into ${projectDir} (${this.installTimeoutMs}ms timeout configured)`);
  }

  /** 当前 CLI 内置版本 */
  async currentVersion(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('@deepstorm/cli/package.json') as { version: string };
    return pkg.version;
  }

  /** 项目内版本是否过期：无标记或版本不一致 */
  async isOutdated(projectDir: string): Promise<boolean> {
    const marker = await this.readVersionMarker(projectDir);
    const current = await this.currentVersion();
    return marker === null || marker.installedVersion !== current;
  }

  private markerPath(projectDir: string): string {
    return path.join(projectDir, VERSION_MARKER_REL);
  }

  private async readVersionMarker(projectDir: string): Promise<VersionMarker | null> {
    try {
      const raw = await fsp.readFile(this.markerPath(projectDir), 'utf8');
      return JSON.parse(raw) as VersionMarker;
    } catch {
      return null;
    }
  }

  private async writeVersionMarker(projectDir: string): Promise<void> {
    const marker: VersionMarker = {
      installedVersion: await this.currentVersion(),
      installedAt: new Date().toISOString(),
    };
    await fsp.mkdir(path.dirname(this.markerPath(projectDir)), { recursive: true });
    await fsp.writeFile(this.markerPath(projectDir), JSON.stringify(marker, null, 2), 'utf8');
  }
}

/** 带超时的 Promise 包装：超过时限即 reject（IO 卡死不再无限等待，调用方 catch 后惰性重试） */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
