# PrimeNG UI 规范

按需加载。仅当需要编写对应组件类型时阅读相关章节。

> **完整示例代码见 `examples/ui-components.md`**。

## 快速参考

### PrimeNG 组件

- 优先 PrimeNG 组件，不用原生 HTML（`<p-button>`、`<p-select>` 等）
- `styleClass` 代替 `class` 传递样式
- `pInvalid` 属性显示验证状态（不是 `invalid` 或 `class.ng-invalid`）
- 样式定制优先 Pass Through（`pt`），不支持时用 Design Tokens（`dt`）
- 禁止覆盖全局 CSS

### 数据表格（p-table）

- CRUD 列表页用 `<p-table>` 的 `lazy` 模式配合 `onLazyLoad` 事件实现服务端分页排序
- 设置 `[rows]` 和 `[totalRecords]`，首屏加载时手动触发一次 `lazy` 加载
- 空数据时设置 `emptyMessage="暂无数据"`（支持自定义 `ng-template pTemplate="emptymessage"`）
- 大数据量（>1000 行）考虑虚拟滚动：`[virtualScroll]="true"` + `[virtualScrollItemSize]="行高"`

### 下拉选择（p-select / p-dropdown）

- 必须设置 `optionLabel` 指定显示字段，`optionValue` 指定值字段（默认 `value`）
- 选项列表应从 Service 通过 httpResource 获取，不要硬编码在组件中
- 需要多选时用 `[multiple]="true"`

### 日期选择（p-datepicker）

- 设置 `dateFormat="yy-mm-dd"` 匹配后端日期格式
- 只选日期用 `[showTime]="false"`（默认），选日期时间用 `[showTime]="true"`

### 按钮（p-button）

- 写操作按钮设置 `[loading]="loading()"` 防止重复提交
- 纯图标按钮必须加 `[pTooltip]="提示"` 和 `aria-label`
- 危险操作（删除）用 `severity="danger"`

### 弹窗/对话框

- 关闭弹窗（`(onHide)`）后需重置表单状态：`form().reset()` + 错误提示清除
- 新增/编辑共用弹窗时，打开前根据 `editingId` 初始化表单值
- 提交完成后关闭弹窗并 reload 列表数据

### 确认操作

- 删除等危险操作使用确认弹窗：`p-confirmPopup` 或 ConfirmDialog
- 批量操作建议使用 `p-confirmDialog`

### 空状态与反馈

- 所有列表页必须有空状态提示
- 操作成功/失败后应有 Toast 反馈（通过 `MessageService`，拦截器已自动处理错误 toast）
- 长时间操作建议显示加载指示器（`p-progressSpinner` 或骨架屏 `p-skeleton`）

### 响应式

- 移动端适配：PrimeNG 响应式 `col-12 md:col-6 lg:col-4` 或 Tailwind `sm:`/`md:` 断点
- 表单在小屏上应单列显示

### 页面标题

- 每个功能页设置 `<title>页面名称 - 应用名</title>` 支持多 tab 导航
- 使用 `Title` service（`inject(Title)`）在 Component 中动态设置
