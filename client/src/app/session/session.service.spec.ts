import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SessionService,
      ],
    });
    service = TestBed.inject(SessionService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listByProject 应 GET /api/v1/projects/:projectName/sessions', () => {
    service.listByProject('project-a').subscribe();

    const req = httpMock.expectOne('/api/v1/projects/project-a/sessions');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('deleteBySdkSessionId 应 DELETE /api/v1/sessions/:sdkSessionId', () => {
    service.deleteBySdkSessionId('abc-123').subscribe();

    const req = httpMock.expectOne('/api/v1/sessions/abc-123');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
