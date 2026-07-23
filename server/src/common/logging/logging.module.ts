import { Global, Module } from '@nestjs/common';
import { SessionLogService } from './session-log.service';

@Global()
@Module({
  providers: [SessionLogService],
  exports: [SessionLogService],
})
export class LoggingModule {}
