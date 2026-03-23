/**
 * Shared calendar types used by calendar-event-list custom tool
 * and monthly-calendar-notify scheduled job.
 */

export interface LarkEvent {
  event_id?: string;
  summary?: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  location?: { name?: string };
  status?: string;
  is_all_day?: boolean;
  organizer_calendar_id?: string;
}

export interface LarkEventListResponse {
  code: number;
  msg?: string;
  data?: {
    items?: LarkEvent[];
    has_more?: boolean;
    page_token?: string;
  };
}
