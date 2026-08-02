import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectModule } from '../project/project.module';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

@Module({
  imports: [AuthModule, ProjectModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
