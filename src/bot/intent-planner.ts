export interface RequesterIdentity {
  userId?: string;
  openId?: string;
  unionId?: string;
  email?: string;
  mobile?: string;
}

export interface IntentSlotHints {
  intent?: 'calendar_freebusy';
  timeMin?: string;
  timeMax?: string;
  confidence: number;
}

export interface IntentPlan {
  normalizedUserText: string;
  slotHints: IntentSlotHints;
}

export interface IntentPlannerLike {
  createPlan(userText: string): IntentPlan;
}

export class IntentPlanner implements IntentPlannerLike {
  createPlan(userText: string): IntentPlan {
    const text = (userText || '').trim();
    const slotHints: IntentSlotHints = { confidence: 0 };
    if (!text) {
      return { normalizedUserText: '', slotHints };
    }

    const isCalendarIntent = /(空き|空いて|予定|都合|free|busy|availability|schedule)/i.test(text);
    if (!isCalendarIntent) {
      return { normalizedUserText: text, slotHints };
    }

    slotHints.intent = 'calendar_freebusy';
    slotHints.confidence = 0.7;

    const range = this.inferTimeRange(text);
    if (range) {
      slotHints.timeMin = range.timeMin;
      slotHints.timeMax = range.timeMax;
      slotHints.confidence = 0.9;
    } else {
      const now = new Date();
      const timeMin = this.toIsoWithOffset(now);
      const future = new Date(now);
      future.setDate(future.getDate() + 7);
      slotHints.timeMin = timeMin;
      slotHints.timeMax = this.toIsoWithOffset(future);
      slotHints.confidence = 0.6;
    }

    return { normalizedUserText: text, slotHints };
  }

  private inferTimeRange(text: string): { timeMin: string; timeMax: string } | null {
    const now = new Date();
    const lower = text.toLowerCase();

    if (/(今日|きょう|today)/i.test(lower)) {
      return this.dayRange(now);
    }
    if (/(明日|あした|tomorrow)/i.test(lower)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return this.dayRange(d);
    }
    if (/(今週|this week)/i.test(lower)) {
      return this.weekRange(now);
    }
    if (/(来週|next week)/i.test(lower)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 7);
      return this.weekRange(d);
    }
    if (/(今月|this month)/i.test(lower)) {
      return this.monthRange(now);
    }
    if (/(来月|next month)/i.test(lower)) {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
      return this.monthRange(d);
    }

    return null;
  }

  private dayRange(base: Date): { timeMin: string; timeMax: string } {
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { timeMin: this.toIsoWithOffset(start), timeMax: this.toIsoWithOffset(end) };
  }

  private weekRange(base: Date): { timeMin: string; timeMax: string } {
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { timeMin: this.toIsoWithOffset(start), timeMax: this.toIsoWithOffset(end) };
  }

  private monthRange(base: Date): { timeMin: string; timeMax: string } {
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);
    return { timeMin: this.toIsoWithOffset(start), timeMax: this.toIsoWithOffset(end) };
  }

  private toIsoWithOffset(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const oh = String(Math.floor(abs / 60)).padStart(2, '0');
    const om = String(abs % 60).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}${sign}${oh}:${om}`;
  }
}
