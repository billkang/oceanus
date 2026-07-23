import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';

export interface AssetItem {
  id: number;
  sessionId: number;
  title: string;
  type: string;
  content: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class AssetService {
  private readonly http = inject(HttpClient);

  /** 获取会话下的资产列表 */
  listBySession(sessionId: number): Observable<AssetItem[]> {
    return this.http.get<AssetItem[]>(`/api/v1/sessions/${sessionId}/assets`);
  }

  /** 获取资产详情 */
  getById(id: number): Observable<AssetItem> {
    return this.http.get<AssetItem>(`/api/v1/assets/${id}`);
  }

  /** 复制资产内容 */
  copyContent(id: number): Observable<{ content: string }> {
    return this.http.post<{ content: string }>(`/api/v1/assets/${id}/copy`, {});
  }

  /** 下载资产（返回内容） */
  download(id: number): Observable<{ content: string; filename: string }> {
    return this.http.get<{ content: string; filename: string }>(`/api/v1/assets/${id}/download`);
  }
}
