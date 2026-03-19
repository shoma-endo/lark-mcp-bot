import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { FunctionDefinition } from '../types.js';
import type { IntentPlan } from './intent-planner.js';

/**
 * Lark MCP skill guide loaded from .agents/skills/lark-mcp/SKILL.md.
 * Injected into the system prompt to help the LLM use Lark MCP tools correctly.
 */
const LARK_MCP_SKILL_GUIDE = (() => {
  try {
    return readFileSync(resolve(process.cwd(), '.agents/skills/lark-mcp/SKILL.md'), 'utf-8');
  } catch {
    return '';
  }
})();

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/** Keywords that trigger Bitable-specific hints in the system prompt. */
const BITABLE_KEYWORDS = /bitable|base|テーブル|フィールド|レコード/i;

/** Keywords that trigger current datetime injection in the system prompt. */
const DATETIME_KEYWORDS = /今日|明日|明後日|昨日|今週|来週|先週|今月|来月|先月|今年|カレンダー|予定|スケジュール|タスク|締め切り|期限|いつ|何時|calendar|task|schedule|today|tomorrow|yesterday|next week|last week/i;

/**
 * Bitable-specific guidance injected only when the user message is
 * Bitable-related, to avoid wasting tokens on unrelated requests.
 */
export const BITABLE_HINTS = `
Bitableテーブルを作成する場合は、以下の手順で行ってください:
1. bitable.v1.app.create でBaseを作成 → レスポンスの app_token を必ず記録する
2. bitable.v1.appTable.create でテーブルとフィールドをまとめて作成（app_tokenは必須）
   - fields配列でフィールドを指定可能。各フィールドは必ず field_name（nameではない）と type を指定すること
   - 例: {"field_name":"顧客名","type":1}, {"field_name":"ステータス","type":3}
3. フィールドを後から追加する場合は bitable.v1.appTableField.create を使用（app_tokenとtable_idは必須）
重要: 各ステップで前のステップの結果から app_token、table_id を取得して引数に必ず渡すこと。

Bitableフィールドのtype値と用途（作成可能なもののみ）:
1=テキスト（メールは ui_type:"Email" を追加）, 2=数値, 3=単一選択, 4=複数選択,
5=日時, 7=チェックボックス, 11=ユーザー（人物。電話・メールに使わないこと）,
13=電話番号, 15=URL, 17=添付ファイル, 18=単方向リンク, 21=双方向リンク
作成不可のため使用禁止（Bitableが自動生成するため手動作成できない）:
1001=作成日時, 1002=更新日時, 1003=作成者, 1004=更新者, 1005=自動番号, 24=Stage, 3001=Button`;

/** Base instructions always included in the system prompt. */
export const BASE_SYSTEM_PROMPT = `あなたはLarkのAIアシスタントボットです。
ユーザーのリクエストに応じてLark APIを通じて様々な操作を実行できます。`;

/** Tool call format reminder always included in the system prompt. */
export const TOOL_CALL_FORMAT_HINT = `重要: tool call の arguments は必ず厳密なJSON objectを出力してください。XML風タグ（<tool_call>, <arg_value>）や key=value 連結形式は使用禁止です。
例: calendar.v4.freebusy.list の arguments は {"time_min":"2025-02-18T00:00:00+09:00","time_max":"2025-02-25T00:00:00+09:00","user_ids":["me"]} のようなJSONにしてください。`;

/** General response style instructions always included in the system prompt. */
export const RESPONSE_STYLE_HINT = `日本語で丁寧に答えてください。ツールを実行する必要がある場合は、適切なツールを選択してください。Markdown記法や記号装飾（例: **, #）は使わず、プレーンテキストで回答してください。
ツール実行でエラーが発生した場合は、エラーメッセージを省略せずそのままユーザーに伝えてください。`;

/**
 * Build the system prompt for a given request.
 * Domain-specific hints (e.g. Bitable) are injected only when relevant.
 */
export function buildSystemPrompt(
  functions: FunctionDefinition[],
  intentPlan: IntentPlan,
  userText = ''
): string {
  const toolDocs = functions.map(f => `- ${f.function.name}: ${f.function.description}`).join('\n');

  const plannerHints = intentPlan.slotHints.intent
    ? `\nPlanner hints:\n- intent: ${intentPlan.slotHints.intent}\n- time_min: ${intentPlan.slotHints.timeMin || '(none)'}\n- time_max: ${intentPlan.slotHints.timeMax || '(none)'}\n- confidence: ${intentPlan.slotHints.confidence}`
    : '';

  const domainHints = BITABLE_KEYWORDS.test(userText) ? `\n${BITABLE_HINTS}` : '';

  const dateTimeHint = DATETIME_KEYWORDS.test(userText)
    ? `\n現在日時: ${new Date().toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short',
      })}（Asia/Tokyo）\n`
    : '';

  const skillGuide = LARK_MCP_SKILL_GUIDE ? `\n## Lark MCP 使用ガイド\n${LARK_MCP_SKILL_GUIDE}` : '';

  return `${BASE_SYSTEM_PROMPT}
${dateTimeHint}
利用可能なツール:
${toolDocs}
${plannerHints}

${TOOL_CALL_FORMAT_HINT}

${RESPONSE_STYLE_HINT}${domainHints}${skillGuide}`;
}

// ---------------------------------------------------------------------------
// Summary prompt
// ---------------------------------------------------------------------------

/** System instruction for conversation summarization. */
export const SUMMARY_SYSTEM_PROMPT =
  '以下の会話履歴を、目的・合意事項・未完了タスク・重要なID/URLに分けて日本語で簡潔に要約してください。1000文字以内。';

// ---------------------------------------------------------------------------
// Error reply prompt
// ---------------------------------------------------------------------------

/** System instruction for LLM-generated error replies shown to users. */
export const ERROR_REPLY_SYSTEM_PROMPT =
  'あなたはLarkボットです。システムエラー時の短い案内文を日本語で1-2文で作成してください。憶測はせず、再試行や確認方法を具体的に示してください。Markdown記法や記号装飾（例: **, #）は使わないでください。';
