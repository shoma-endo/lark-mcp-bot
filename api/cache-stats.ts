import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cacheTracker } from '../src/utils/cache-tracker.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const stats = cacheTracker.getStatistics();

    // Format as markdown for easy reading
    const markdown = `# GLM Context Cache Statistics

## Overview
- Total Requests: ${stats.total_requests}
- Total Tokens: ${stats.total_prompt_tokens + stats.total_completion_tokens.toLocaleString()}
  - Prompt: ${stats.total_prompt_tokens.toLocaleString()}
  - Completion: ${stats.total_completion_tokens.toLocaleString()}

## Cache Performance
- Cached Tokens: ${stats.total_cached_tokens.toLocaleString()} (${(stats.total_cached_tokens / (stats.total_prompt_tokens || 1) * 100).toFixed(2)}%)
- Cache Hit Rate: ${stats.cache_hit_rate.toFixed(2)}%
- Average Cache Efficiency: ${stats.average_cache_efficiency.toFixed(2)}%

## Cost Analysis
- Standard Cost (no cache): $${stats.total_cost_standard.toFixed(4)}
- Actual Cost (with cache): $${stats.total_cost_actual.toFixed(4)}
- Total Savings: $${stats.total_cost_saving.toFixed(4)} (${(stats.total_cost_saving / (stats.total_cost_standard || 1) * 100).toFixed(2)}%)

## Recent Activity
| Time | Prompt | Completion | Cached | Cache % | Saved |
|------|--------|-------------|---------|---------|-------|
${stats.records.slice(-10).map(r => {
  const time = new Date(r.timestamp).toLocaleTimeString('ja-JP');
  return `| ${time} | ${r.prompt_tokens} | ${r.completion_tokens} | ${r.cached_tokens} | ${r.cache_efficiency_percent.toFixed(1)}% | $${r.cost_saving.toFixed(6)} |`;
}).join('\n')}

---
*Statistics based on last ${stats.records.length} requests*
`;

    res.status(200).json({
      statistics: stats,
      markdown,
    });
  } catch (error) {
    console.error('Error fetching cache statistics:', error);
    res.status(500).json({ error: 'Failed to fetch cache statistics' });
  }
}
