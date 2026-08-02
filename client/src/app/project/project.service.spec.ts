import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ProjectService,
      ],
    });
    service = TestBed.inject(ProjectService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('list 应 GET /api/v1/projects', () => {
    const mockProjects = [
      { id: 1, projectName: 'project-a', displayName: '项目1', sessionCount: 3, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    ];

    service.list().subscribe((res) => {
      expect(res).toEqual(mockProjects);
    });

    const req = httpMock.expectOne('/api/v1/projects');
    expect(req.request.method).toBe('GET');
    req.flush(mockProjects);
  });

  it('create 应 POST /api/v1/projects', () => {
    service.create({ displayName: '新项目', projectName: 'project-a', description: '备注' }).subscribe();

    const req = httpMock.expectOne('/api/v1/projects');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ displayName: '新项目', projectName: 'project-a', description: '备注' });
    req.flush({ id: 1, projectName: 'project-a', displayName: '新项目' });
  });

  it('update 应 PATCH /api/v1/projects/:projectName', () => {
    service.update('project-a', { displayName: '新名称', description: '新描述' }).subscribe();

    const req = httpMock.expectOne('/api/v1/projects/project-a');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ displayName: '新名称', description: '新描述' });
    req.flush({ id: 1, projectName: 'project-a', displayName: '新名称' });
  });

  it('delete 应 DELETE /api/v1/projects/:projectName', () => {
    service.delete('project-a').subscribe();

    const req = httpMock.expectOne('/api/v1/projects/project-a');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
