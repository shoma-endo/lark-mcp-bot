import { describe, it, expect, beforeEach } from 'vitest';
import { CacheTracker, TokenUsageRecord } from '../src/utils/cache-tracker.js';

describe('CacheTracker', () => {
  let tracker: CacheTracker;

  beforeEach(() => {
    tracker = new CacheTracker();
  });

  describe('record', () => {
    it('should record token usage correctly', () => {
      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 50,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.00125,
        cost_saving: 0.00025,
      });

      const stats = tracker.getStatistics();
      expect(stats.total_requests).toBe(1);
      expect(stats.total_prompt_tokens).toBe(100);
      expect(stats.total_completion_tokens).toBe(50);
      expect(stats.total_cached_tokens).toBe(50);
    });

    it('should limit records to maxRecords', () => {
      const maxRecords = 1000;
      for (let i = 0; i < maxRecords + 100; i++) {
        tracker.record({
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cached_tokens: 5,
          cache_efficiency_percent: 50,
          estimated_cost_standard: 0.00015,
          estimated_cost_actual: 0.000125,
          cost_saving: 0.000025,
        });
      }

      expect(tracker.getRecordsCount()).toBe(maxRecords);
    });
  });

  describe('getStatistics', () => {
    it('should return zero statistics when no records', () => {
      const stats = tracker.getStatistics();

      expect(stats.total_requests).toBe(0);
      expect(stats.total_prompt_tokens).toBe(0);
      expect(stats.total_completion_tokens).toBe(0);
      expect(stats.total_cached_tokens).toBe(0);
      expect(stats.average_cache_efficiency).toBe(0);
      expect(stats.total_cost_standard).toBe(0);
      expect(stats.total_cost_actual).toBe(0);
      expect(stats.total_cost_saving).toBe(0);
      expect(stats.cache_hit_rate).toBe(0);
    });

    it('should calculate average cache efficiency correctly', () => {
      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 50,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.00125,
        cost_saving: 0.00025,
      });

      tracker.record({
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        cached_tokens: 100,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.003,
        estimated_cost_actual: 0.0025,
        cost_saving: 0.0005,
      });

      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 0,
        cache_efficiency_percent: 0,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.0015,
        cost_saving: 0,
      });

      const stats = tracker.getStatistics();

      // Average should be (50 + 50) / 2 = 50 (excluding the record with 0 cache)
      expect(stats.average_cache_efficiency).toBe(50);
    });

    it('should calculate cache hit rate correctly', () => {
      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 50,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.00125,
        cost_saving: 0.00025,
      });

      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 0,
        cache_efficiency_percent: 0,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.0015,
        cost_saving: 0,
      });

      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 80,
        cache_efficiency_percent: 80,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.0011,
        cost_saving: 0.0004,
      });

      const stats = tracker.getStatistics();

      // Cache hit rate: 2 out of 3 requests = 66.67%
      expect(stats.cache_hit_rate).toBeCloseTo(66.67, 2);
    });

    it('should calculate cost savings correctly', () => {
      tracker.record({
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        cached_tokens: 500,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.015,
        estimated_cost_actual: 0.0125,
        cost_saving: 0.0025,
      });

      tracker.record({
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        cached_tokens: 800,
        cache_efficiency_percent: 80,
        estimated_cost_standard: 0.015,
        estimated_cost_actual: 0.011,
        cost_saving: 0.004,
      });

      const stats = tracker.getStatistics();

      expect(stats.total_cost_standard).toBeCloseTo(0.03, 4);
      expect(stats.total_cost_actual).toBeCloseTo(0.0235, 4);
      expect(stats.total_cost_saving).toBeCloseTo(0.0065, 4);
    });
  });

  describe('getRecentRecords', () => {
    it('should return recent records up to the limit', () => {
      for (let i = 0; i < 20; i++) {
        tracker.record({
          prompt_tokens: 10 * i,
          completion_tokens: 5 * i,
          total_tokens: 15 * i,
          cached_tokens: 5 * i,
          cache_efficiency_percent: 50,
          estimated_cost_standard: 0.00015 * i,
          estimated_cost_actual: 0.000125 * i,
          cost_saving: 0.000025 * i,
        });
      }

      const recent = tracker.getRecentRecords(5);

      expect(recent).toHaveLength(5);
      expect(recent[0].prompt_tokens).toBe(150); // Record 16
      expect(recent[4].prompt_tokens).toBe(190); // Record 20 (last)
    });

    it('should return all records if limit exceeds total', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record({
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cached_tokens: 5,
          cache_efficiency_percent: 50,
          estimated_cost_standard: 0.00015,
          estimated_cost_actual: 0.000125,
          cost_saving: 0.000025,
        });
      }

      const recent = tracker.getRecentRecords(20);

      expect(recent).toHaveLength(10);
    });
  });

  describe('getRecordsSince', () => {
    it('should filter records by timestamp', () => {
      const now = Date.now();

      tracker.record({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cached_tokens: 50,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.0015,
        estimated_cost_actual: 0.00125,
        cost_saving: 0.00025,
      });

      tracker.record({
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        cached_tokens: 100,
        cache_efficiency_percent: 50,
        estimated_cost_standard: 0.003,
        estimated_cost_actual: 0.0025,
        cost_saving: 0.0005,
      });

      const recordsSinceNow = tracker.getRecordsSince(now);
      expect(recordsSinceNow.length).toBeGreaterThan(0);

      const recordsSinceTomorrow = tracker.getRecordsSince(now + 86400000);
      expect(recordsSinceTomorrow).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all records', () => {
      for (let i = 0; i < 10; i++) {
        tracker.record({
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          cached_tokens: 5,
          cache_efficiency_percent: 50,
          estimated_cost_standard: 0.00015,
          estimated_cost_actual: 0.000125,
          cost_saving: 0.000025,
        });
      }

      expect(tracker.getRecordsCount()).toBe(10);

      tracker.clear();

      expect(tracker.getRecordsCount()).toBe(0);

      const stats = tracker.getStatistics();
      expect(stats.total_requests).toBe(0);
    });
  });
});
