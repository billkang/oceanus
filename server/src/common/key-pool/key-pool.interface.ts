export interface KeyPoolEntry {
  key: string;
  usageCount: number;
  failureCount: number;
  lastFailureAt: number | null;
}

export interface KeyPoolStats {
  totalKeys: number;
  healthyKeys: number;
  totalUsage: number;
  totalFailures: number;
}
