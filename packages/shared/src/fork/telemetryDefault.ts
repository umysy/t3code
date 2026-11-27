/**
 * In this fork, product analytics, relay tracing, and mobile diagnostics default to off.
 * Accepts an optional official default so upstream CI hooks keep their references without
 * turning telemetry on by default.
 */
export const isTelemetryEnabledByDefault = (_officialDefault?: boolean): boolean => false;
