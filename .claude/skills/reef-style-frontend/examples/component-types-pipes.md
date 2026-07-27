# 前端组件模式、类型与 Pipe 示例

## 1. Discriminated Union（多态类型）

```typescript
type FormControl = TextControl | NumberControl | ChoiceControl;
interface TextControl {
  type: 'TextControl';
  label: string;
  maxLength?: number;
}
interface NumberControl {
  type: 'NumberControl';
  min?: number;
  max?: number;
}
interface ChoiceControl {
  type: 'ChoiceControl';
  options: Option[];
}

// Answer 多态（对应 Java 子类）
type Answer = UuidAnswer | TextAnswer | ChoiceAnswer | TableAnswer;
interface UuidAnswer {
  type: 'UuidAnswer';
  value: string | null;
}
interface TextAnswer {
  type: 'TextAnswer';
  value: string | null;
}
```

## 2. 日期 Pipe

```typescript
@Pipe({ name: 'localDateTime' })
export class LocalDateTimePipe implements PipeTransform {
  transform(value: LocalDateTime, pattern = 'yyyy-MM-dd HH:mm:ss') {
    return value.format(DateTimeFormatter.ofPattern(pattern));
  }
}
```

## 3. 组件 Host 动画

```typescript
@Component({
  host: {
    class: 'text-red-500 text-sm',
    'animate.enter': `
      starting:opacity-0 starting:-translate-y-1
      transition-all duration-250 ease-out
    `,
    'animate.leave': `
      opacity-0 -translate-y-1
      transition-all duration-100 ease-in
    `,
  },
})
export class ErrorMessages {
  readonly errors = input.required<ValidationError[]>();
}
```

## 4. input() / model() / output() 模式

```typescript
readonly appId = input.required<number>();
readonly config = input<Config>(DEFAULT_CONFIG);
readonly visible = model(false);       // 双向绑定父组件 [(visible)]
readonly delete = output<number>();    // 子传父事件
```
