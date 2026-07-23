import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('缺少认证 Token');
    }

    try {
      const payload = this.jwtService.verify<{ sub: number; username: string }>(token);
      // 将用户信息挂载到 request 上，供后续 handler 使用
      request.user = { id: payload.sub, username: payload.username };
      return true;
    } catch {
      throw new UnauthorizedException('Token 无效或已过期');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer') return token;

    // 支持 SSE query param token（EventSource 不支持自定义 header）
    if (typeof request.query?.token === 'string') {
      return request.query.token;
    }

    return undefined;
  }
}
