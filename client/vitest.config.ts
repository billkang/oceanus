import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 在 JIT 测试中内联 Angular templateUrl，避免 resource resolution 问题 */
function inlineAngularTemplates(): import('vite').Plugin {
  return {
    name: 'inline-angular-templates',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.endsWith('.component.ts')) return;
      const match = code.match(/templateUrl:\s*['"](.+?)['"]/);
      if (!match) return;
      const templatePath = resolve(id, '..', match[1]);
      try {
        const content = readFileSync(templatePath, 'utf-8');
        return code.replace(/templateUrl:\s*['"](.+?)['"]/, `template: ${JSON.stringify(content)}`);
      } catch {
        console.warn(`[inline-angular-templates] Failed to read: ${templatePath}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [inlineAngularTemplates()],
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:4300',
        storageQuota: 10_000_000,
      },
    },
    setupFiles: ['src/test-setup.ts'],
    // Suppress localStorage-origin warnings in jsdom
    env: {},
  },
});
