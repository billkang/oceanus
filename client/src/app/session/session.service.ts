import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';

export interface Session {
  id: number;
  sdkSessionId: string;
  title: string;
  status: string;
  username: string;
  lastMessageAt: string | null;
  projectId: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  listByProject(projectName: string): Observable<Session[]> {
    return this.http.get<Session[]>(`/api/v1/projects/${projectName}/sessions`);
  }

  deleteBySdkSessionId(sdkSessionId: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/sessions/${sdkSessionId}`);
  }
}
