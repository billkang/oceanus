import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';

export interface Project {
  id: number;
  projectName: string;
  displayName: string;
  description: string | null;
  sessionCount: number;
  role?: 'owner' | 'member';
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectDto {
  displayName: string;
  projectName: string;
  description?: string;
}

/** 编辑项目（projectName 不可改，仅 displayName/description） */
export interface UpdateProjectDto {
  displayName?: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);

  list(): Observable<Project[]> {
    return this.http.get<Project[]>('/api/v1/projects');
  }

  getById(projectName: string): Observable<Project> {
    return this.http.get<Project>(`/api/v1/projects/${projectName}`);
  }

  create(dto: CreateProjectDto): Observable<Project> {
    return this.http.post<Project>('/api/v1/projects', dto);
  }

  update(projectName: string, dto: UpdateProjectDto): Observable<Project> {
    return this.http.patch<Project>(`/api/v1/projects/${projectName}`, dto);
  }

  delete(projectName: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${projectName}`);
  }
}
