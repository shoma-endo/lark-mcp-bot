import { config } from '../config.js';
import type { LogContext } from '../types.js';

/**
 * Log levels in order of severity
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

/**
 * Performance metrics tracker
 */
interface PerformanceMetric {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  context?: Record<string, unknown>;
}

/**
 * Enhanced logger with structured logging and performance metrics
 */
export class Logger {
  private configuredLevel: number;
  private enableMetrics: boolean;
  private activeMetrics: Map<string, PerformanceMetric> = new Map();

  constructor(logLevel?: LogLevel, enableMetrics?: boolean) {
    this.configuredLevel = LOG_LEVELS[logLevel || config.logLevel];
    this.enableMetrics = enableMetrics ?? config.enablePerformanceMetrics;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.configuredLevel;
  }

  /**
   * Format log data as JSON
   */
  private formatLog(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
    additional?: Record<string, unknown>
  ): string {
    const logData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      }),
      ...additional,
    };

    return JSON.stringify(logData);
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: LogContext, additional?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    console.log(this.formatLog('debug', message, context, undefined, additional));
  }

  /**
   * Log at info level
   */
  info(message: string, context?: LogContext, additional?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    console.log(this.formatLog('info', message, context, undefined, additional));
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: LogContext, error?: Error, additional?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatLog('warn', message, context, error, additional));
  }

  /**
   * Log at error level
   */
  error(message: string, context?: LogContext, error?: Error, additional?: Record<string, unknown>): void {
    if (!this.shouldLog('error')) return;
    console.error(this.formatLog('error', message, context, error, additional));
  }

  /**
   * Start tracking performance for an operation
   */
  startMetric(metricId: string, operation: string, context?: Record<string, unknown>): void {
    if (!this.enableMetrics) return;

    this.activeMetrics.set(metricId, {
      operation,
      startTime: Date.now(),
      context,
    });

    this.debug(`Performance metric started`, { metricId, operation } as LogContext, context);
  }

  /**
   * End tracking performance and log the result
   */
  endMetric(metricId: string, context?: LogContext, additional?: Record<string, unknown>): void {
    if (!this.enableMetrics) return;

    const metric = this.activeMetrics.get(metricId);
    if (!metric) {
      this.warn(`Performance metric not found`, { metricId } as LogContext);
      return;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    this.info(`Performance metric completed`, context, {
      metricId,
      operation: metric.operation,
      duration_ms: metric.duration,
      ...metric.context,
      ...additional,
    });

    this.activeMetrics.delete(metricId);
  }

  /**
   * Log a metric without tracking (for one-off measurements)
   */
  logMetric(operation: string, duration: number, context?: LogContext, additional?: Record<string, unknown>): void {
    if (!this.enableMetrics) return;

    this.info(`Performance metric`, context, {
      operation,
      duration_ms: duration,
      ...additional,
    });
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return Object.keys(LOG_LEVELS).find(
      (key) => LOG_LEVELS[key as LogLevel] === this.configuredLevel
    ) as LogLevel;
  }

  /**
   * Check if metrics are enabled
   */
  areMetricsEnabled(): boolean {
    return this.enableMetrics;
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();
