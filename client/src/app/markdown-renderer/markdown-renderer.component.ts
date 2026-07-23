import { ChangeDetectionStrategy, Component, input, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
  let result = escapeHtml(text);
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-800">$1</strong>');
  // Italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  result = result.replace(
    /`(.+?)`/g,
    '<code class="bg-gray-100 text-indigo-600 px-1.5 py-0.5 rounded text-xs font-mono">$1</code>',
  );
  return result;
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let codeContent: string[] = [];
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        htmlLines.push(
          `<pre class="bg-gray-100 rounded-lg p-4 overflow-x-auto text-sm leading-relaxed">` +
            `${escapeHtml(codeContent.join('\n'))}</pre>`,
        );
        codeContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeContent.push(line);
      continue;
    }

    // Table (simple pipe table)
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
      if (line.includes('---') && inTable) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableRows = [
          `<tr>${cells
            .map(
              (c) =>
                `<th class="text-left px-3 py-2 text-sm font-semibold text-gray-700 border-b border-gray-200">` +
                  `${inlineMarkdown(c)}</th>`,
            )
            .join('')}</tr>`,
        ];
      } else {
        tableRows.push(
          `<tr>${cells
            .map(
              (c) =>
                `<td class="px-3 py-2 text-sm text-gray-600 border-b border-gray-100">${inlineMarkdown(c)}</td>`,
            )
            .join('')}</tr>`,
        );
      }
      const nextLine = lines[i + 1];
      if (!nextLine || !nextLine.trim().startsWith('|')) {
        htmlLines.push(`<div class="overflow-x-auto"><table class="w-full">${tableRows.join('')}</table></div>`);
        inTable = false;
        tableRows = [];
      }
      continue;
    }
    if (inTable) {
      continue;
    }

    if (line.trim() === '') {
      htmlLines.push('');
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = inlineMarkdown(hMatch[2]);
      const sizes = [
        'text-xl font-bold mt-6 mb-3',
        'text-lg font-semibold mt-5 mb-2',
        'text-base font-semibold mt-4 mb-2',
      ];
      htmlLines.push(`<h${level} class="${sizes[level - 1]} text-gray-900">${text}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---$/.test(line.trim())) {
      htmlLines.push('<hr class="my-6 border-gray-200" />');
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      htmlLines.push(
        `<li class="text-sm text-gray-600 leading-relaxed ml-${Math.min(indent * 4 + 4, 8)} list-disc">` +
          `${inlineMarkdown(ulMatch[2])}</li>`,
      );
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      htmlLines.push(
        `<li class="text-sm text-gray-600 leading-relaxed ml-5 list-decimal">${inlineMarkdown(olMatch[2])}</li>`,
      );
      continue;
    }

    // Regular paragraph
    htmlLines.push(`<p class="text-sm text-gray-600 leading-relaxed mb-3">${inlineMarkdown(line)}</p>`);
  }

  return htmlLines.join('\n');
}

@Component({
  selector: 'app-markdown-renderer',
  standalone: true,
  template: `
    <div class="prose prose-sm prose-gray max-w-none" [innerHTML]="renderedContent()"></div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownRendererComponent {
  readonly content = input('');

  private readonly sanitizer = inject(DomSanitizer);

  renderedContent(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(this.content()));
  }
}
