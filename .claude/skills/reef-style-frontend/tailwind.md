# Tailwind CSS 规范

## 概述

使用 Tailwind CSS v4 的 utility-first 方式编写样式，不编写自定义 CSS。

## 核心原则

- **优先使用 Tailwind utility class**，不写手写 CSS
- **组件样式写在模板的 `class` 属性中**，不在独立 CSS 文件中
- **仅在以下场景使用 `@apply`**：多个重复使用的 utility 组合
- **响应式**：使用 `sm:` / `md:` / `lg:` / `xl:` 前缀

## 常用模式

### 布局

```html
<!-- Flex 布局 -->
<div class="flex items-center justify-between gap-4">
  <div class="flex-1">左侧</div>
  <div>右侧</div>
</div>

<!-- Grid 布局 -->
<div class="grid grid-cols-3 gap-6">
  <div class="col-span-2">主区域</div>
  <div>侧边栏</div>
</div>
```

### 间距

```html
<!-- 内边距 -->
<div class="p-4 px-6 py-2 pt-0">
  <!-- 外边距 -->
  <div class="m-4 mt-2 mx-auto"></div>
</div>
```

### 颜色

```html
<!-- 使用 Tailwind 色板 -->
<div class="bg-blue-500 text-white hover:bg-blue-600">
  <button class="text-gray-700 border border-gray-300 rounded"></button>
</div>
```

### 圆角与阴影

```html
<div class="rounded-lg shadow-sm">
  <button class="rounded-full shadow-md"></button>
</div>
```

### 暗色模式

```html
<div class="bg-white dark:bg-gray-900 text-black dark:text-white"></div>
```

## 自定义配置

```css
/* app.css — 仅添加 Tailwind 不支持的全局样式 */
@import 'tailwindcss';

@theme {
  --color-primary: #3b82f6;
  --color-secondary: #8b5cf6;
}
```

## 禁止事项

- ❌ 不写手写 CSS 覆盖 Tailwind utility
- ❌ 不使用 `!important`（Tailwind 的优先级系统已足够）
- ❌ 不创建大量 `@apply` 封装（失去 utility-first 的优势）
