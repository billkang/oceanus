import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AssetService } from './asset.service';

describe('AssetService', () => {
  let service: AssetService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        AssetService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    service = TestBed.inject(AssetService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock?.verify();
  });

  it('listBySession 应获取资产列表', async () => {
    const mockAssets = [
      { id: 1, sessionId: 1, title: 'PRD', type: 'prd', content: '# PRD', createdAt: new Date().toISOString() },
    ];
    const result = service.listBySession(1).toPromise();
    const req = httpMock.expectOne('/api/v1/sessions/1/assets');
    expect(req.request.method).toBe('GET');
    req.flush(mockAssets);
    await expect(result).resolves.toEqual(mockAssets);
  });

  it('getById 应获取资产详情', async () => {
    const mockAsset = {
      id: 1, sessionId: 1, title: 'PRD', type: 'prd',
      content: '# PRD 内容', createdAt: new Date().toISOString(),
    };
    const result = service.getById(1).toPromise();
    const req = httpMock.expectOne('/api/v1/assets/1');
    expect(req.request.method).toBe('GET');
    req.flush(mockAsset);
    await expect(result).resolves.toEqual(mockAsset);
  });

  it('copyContent 应返回资产内容', async () => {
    const result = service.copyContent(1).toPromise();
    const req = httpMock.expectOne('/api/v1/assets/1/copy');
    expect(req.request.method).toBe('POST');
    req.flush({ content: '# PRD 内容' });
    await expect(result).resolves.toEqual({ content: '# PRD 内容' });
  });

  it('download 应返回下载信息', async () => {
    const result = service.download(1).toPromise();
    const req = httpMock.expectOne('/api/v1/assets/1/download');
    expect(req.request.method).toBe('GET');
    req.flush({ content: '# PRD', filename: 'PRD.md' });
    await expect(result).resolves.toEqual({ content: '# PRD', filename: 'PRD.md' });
  });
});
