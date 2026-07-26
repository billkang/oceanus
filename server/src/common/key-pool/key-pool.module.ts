import { Global, Module } from '@nestjs/common';
import { KeyPoolService } from './key-pool.service';

@Global()
@Module({
  providers: [KeyPoolService],
  exports: [KeyPoolService],
})
export class KeyPoolModule {}
