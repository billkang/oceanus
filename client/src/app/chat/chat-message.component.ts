import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export enum MessageStatus {
  Sending = 'sending',
  Streaming = 'streaming',
  Complete = 'complete',
  Error = 'error',
}

export interface DisplayMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  status: MessageStatus;
  errorMessage?: string;
  options?: string[];
  optionsText?: string;
  selectedOption?: string;
}

@Component({
  selector: 'app-chat-message',
  imports: [DatePipe, Button, InputText, FormField],
  standalone: true,
  template: `
    <div
      class="flex items-start gap-2.5 mb-3 animate-message-in"
      [class.flex-row-reverse]="message().role === 'user'"
    >
      <!-- Avatar -->
      <div
        class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold select-none"
        [class.bg-gradient-to-br]="true"
        [class.from-indigo-500]="message().role === 'assistant'"
        [class.to-violet-500]="message().role === 'assistant'"
        [class.!text-white]="message().role === 'assistant'"
        [class.bg-indigo-100]="message().role === 'user'"
        [class.!text-indigo-600]="message().role === 'user'"
      >
        @if (message().role === 'assistant') {
          <i class="pi pi-sparkles text-sm"></i>
        } @else {
          <i class="pi pi-user text-sm"></i>
        }
      </div>

      <!-- Bubble -->
      <div class="max-w-[75%]">
        <div
          class="rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm"
          [class.bg-gradient-to-br]="message().role === 'user'"
          [class.from-indigo-500]="message().role === 'user'"
          [class.to-violet-500]="message().role === 'user'"
          [class.!text-white]="message().role === 'user'"
          [class.rounded-br-md]="message().role === 'user'"
          [class.bg-white]="message().role === 'assistant'"
          [class.!text-gray-800]="message().role === 'assistant'"
          [class.border]="message().role === 'assistant'"
          [class.!border-indigo-100]="message().role === 'assistant'"
          [class.rounded-bl-md]="message().role === 'assistant'"
        >
          <!-- User message -->
          @if (message().role === 'user') {
            <div class="whitespace-pre-wrap text-[15px] leading-relaxed opacity-95">{{ message().content }}</div>
          }

          <!-- Assistant message with options (确认交互) -->
          @if (message().role === 'assistant' && message().options && message().options!.length > 0) {
            <div>
              @if (message().optionsText) {
                <div class="mb-2.5 text-gray-600 whitespace-pre-wrap">{{ message().optionsText }}</div>
              }
              @if (message().selectedOption) {
                <div
                  class="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2
                    text-indigo-600 font-medium text-sm"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  已选择：{{ message().selectedOption }}
                </div>
              } @else {
                <div class="flex flex-wrap gap-2 mt-1">
                  @for (opt of message().options; track opt) {
                    <p-button
                      [outlined]="true"
                      severity="secondary"
                      styleClass="!rounded-full !border-indigo-300 !text-indigo-600
                        hover:!bg-indigo-50 hover:!border-indigo-400"
                      (onClick)="onOptionClick(opt)"
                    >
                      {{ opt }}
                    </p-button>
                  }
                  @if (!showOtherInput()) {
                    <p-button
                      [outlined]="true"
                      severity="secondary"
                      styleClass="!rounded-full"
                      (onClick)="showOtherInput.set(true)"
                    >
                      其他...
                    </p-button>
                  }
                </div>
                @if (showOtherInput()) {
                  <div class="flex gap-2 mt-2.5">
                    <input
                      pInputText
                      type="text"
                      class="flex-1 !rounded-xl"
                      [formField]="otherForm.value"
                      placeholder="请输入..."
                      (keydown)="onOtherKeydown($event)"
                    />
                    <p-button
                      label="确认"
                      styleClass="!rounded-xl !bg-indigo-500 !text-white"
                      [disabled]="!otherModel().value.trim()"
                      (onClick)="submitOther()"
                    />
                  </div>
                }
              }
            </div>
          }

          <!-- Assistant message (normal) -->
          @if (message().role === 'assistant' && (!message().options || message().options!.length === 0)) {
            @if (message().status === 'error' && message().errorMessage) {
              <div class="flex items-start gap-2 text-rose-600 mb-1">
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" class="mt-0.5 flex-shrink-0"
                  stroke-linecap="round" stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <span>{{ message().errorMessage }}</span>
              </div>
            } @else {
              <div class="markdown-content whitespace-pre-wrap text-[15px] leading-relaxed">
                {{ message().content }}
              </div>
              <!-- Streaming indicator -->
              @if (message().status === 'streaming') {
                <span class="inline-flex items-center gap-[3px] ml-0.5 align-middle h-[18px]">
                  <span class="w-[3px] h-3 bg-indigo-500 rounded-full animate-wave-pulse"
                    style="animation-delay: 0s"></span>
                  <span class="w-[3px] h-3 bg-indigo-500 rounded-full animate-wave-pulse"
                    style="animation-delay: 0.2s"></span>
                  <span class="w-[3px] h-3 bg-indigo-500 rounded-full animate-wave-pulse"
                    style="animation-delay: 0.4s"></span>
                </span>
              }
            }
          }

          <!-- Retry button for user messages in error state -->
          @if (message().role === 'user' && message().status === 'error') {
            <div>
              <div class="whitespace-pre-wrap text-[15px] leading-relaxed opacity-90">{{ message().content }}</div>
              <div class="flex items-center gap-3 mt-2 pt-2 border-t border-white/20">
                <span class="text-xs text-rose-200">{{ message().errorMessage || '发送失败' }}</span>
                <p-button
                  [link]="true"
                  size="small"
                  styleClass="text-xs !text-white/90 hover:!text-white underline underline-offset-2"
                  (onClick)="retry.emit()"
                >
                  重试
                </p-button>
              </div>
            </div>
          }

          <!-- Sending indicator -->
          @if (message().status === 'sending') {
            <div class="flex items-center gap-2 mt-1.5">
              <span
                class="inline-block w-3.5 h-3.5 border-2 border-white/60
                  border-t-white rounded-full animate-spin"
              ></span>
              <span class="text-xs opacity-70">发送中...</span>
            </div>
          }
        </div>

        <!-- Timestamp -->
        <div
          class="flex items-center gap-1 mt-1 px-1"
          [class.justify-end]="message().role === 'user'"
        >
          <span class="text-[10px] text-gray-400">
            @if (message().status === 'sending') { 发送中... }
            @else if (message().status === 'error') { 发送失败 }
            @else { {{ message().timestamp | date: 'HH:mm' }} }
          </span>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessageComponent {
  readonly message = input.required<DisplayMessage>();
  readonly optionSelect = output<string>();
  readonly retry = output<void>();

  readonly showOtherInput = signal(false);
  readonly otherModel = signal({ value: '' });
  readonly otherForm = form(this.otherModel);

  onOptionClick(option: string): void {
    this.optionSelect.emit(option);
  }

  onOtherKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.otherModel().value.trim()) {
      this.submitOther();
    }
  }

  submitOther(): void {
    const value = this.otherModel().value.trim();
    if (value) {
      this.optionSelect.emit(value);
      this.showOtherInput.set(false);
      this.otherModel.set({ value: '' });
    }
  }
}
