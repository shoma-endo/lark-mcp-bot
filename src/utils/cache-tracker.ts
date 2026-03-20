/**
 * Token usage and cache statistics tracker
 */

export interface TokenUsageRecord {
  timestamp: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  cache_efficiency_percent: number;
  estimated_cost_standard: number;
  estimated_cost_actual: number;
  cost_saving: number;
}

export interface CacheStatistics {
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cached_tokens: number;
  average_cache_efficiency: number;
  total_cost_standard: number;
  total_cost_actual: number;
  total_cost_saving: number;
  cache_hit_rate: number;
  records: TokenUsageRecord[];
}

export class CacheTracker {
  private records: TokenUsageRecord[] = [];
  private maxRecords = 1000;

  record(usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
    cache_efficiency_percent: number;
    estimated_cost_standard: number;
    estimated_cost_actual: number;
    cost_saving: number;
  }): void {
    const record: TokenUsageRecord = {
      timestamp: Date.now(),
      ...usage,
    };

    this.records.push(record);

    // Limit records to prevent memory issues
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  getStatistics(): CacheStatistics {
    if (this.records.length === 0) {
      return {
        total_requests: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_cached_tokens: 0,
        average_cache_efficiency: 0,
        total_cost_standard: 0,
        total_cost_actual: 0,
        total_cost_saving: 0,
        cache_hit_rate: 0,
        records: [],
      };
    }

    const totalRequests = this.records.length;
    const totalPromptTokens = this.records.reduce((sum, r) => sum + r.prompt_tokens, 0);
    const totalCompletionTokens = this.records.reduce((sum, r) => sum + r.completion_tokens, 0);
    const totalCachedTokens = this.records.reduce((sum, r) => sum + r.cached_tokens, 0);
    const totalCostStandard = this.records.reduce((sum, r) => sum + r.estimated_cost_standard, 0);
    const totalCostActual = this.records.reduce((sum, r) => sum + r.estimated_cost_actual, 0);
    const totalCostSaving = this.records.reduce((sum, r) => sum + r.cost_saving, 0);
    
    // Average cache efficiency (only include records where there's a cache hit)
    const recordsWithCacheHit = this.records.filter(r => r.cached_tokens > 0);
    const avgCacheEfficiency = recordsWithCacheHit.length > 0
      ? recordsWithCacheHit.reduce((sum, r) => sum + r.cache_efficiency_percent, 0) / recordsWithCacheHit.length
      : 0;

    // Cache hit rate: percentage of requests with any cache hit
    const cacheHitRate = (recordsWithCacheHit.length / totalRequests) * 100;

    return {
      total_requests: totalRequests,
      total_prompt_tokens: totalPromptTokens,
      total_completion_tokens: totalCompletionTokens,
      total_cached_tokens: totalCachedTokens,
      average_cache_efficiency: avgCacheEfficiency,
      total_cost_standard: totalCostStandard,
      total_cost_actual: totalCostActual,
      total_cost_saving: totalCostSaving,
      cache_hit_rate: cacheHitRate,
      records: [...this.records],
    };
  }

  getRecentRecords(limit: number = 50): TokenUsageRecord[] {
    return this.records.slice(-limit);
  }

  getRecordsSince(timestamp: number): TokenUsageRecord[] {
    return this.records.filter(r => r.timestamp >= timestamp);
  }

  clear(): void {
    this.records = [];
  }

  getRecordsCount(): number {
    return this.records.length;
  }
}

// Global instance
export const cacheTracker = new CacheTracker();
