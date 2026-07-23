import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';

export interface Project {
  id: number;
  name: string;
  description: string | null;
  sessionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectDto {
  name: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);

  list(): Observable<Project[]> {
    return this.http.get<Project[]>('/api/v1/projects');
  }

  getById(id: number): Observable<Project> {
    return this.http.get<Project>(`/api/v1/projects/${id}`);
  }

  create(dto: CreateProjectDto): Observable<Project> {
    return this.http.post<Project>('/api/v1/projects', dto);
  }

  update(id: number, dto: CreateProjectDto): Observable<Project> {
    return this.http.put<Project>(`/api/v1/projects/${id}`, dto);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/projects/${id}`);
  }
}
