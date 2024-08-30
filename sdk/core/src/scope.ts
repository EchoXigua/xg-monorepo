import type {
  // Attachment,
  // Breadcrumb,
  // CaptureContext,
  // Client,
  // Context,
  // Contexts,
  // Event,
  // EventHint,
  // EventProcessor,
  // Extra,
  // Extras,
  // Primitive,
  // PropagationContext,
  // RequestSession,
  Scope as ScopeInterface,
  // ScopeContext,
  // ScopeData,
  // Session,
  // SeverityLevel,
  // User,
} from '@xigua-monitor/types';

class ScopeClass implements ScopeInterface {}

/**
 * Holds additional event information.
 */
export const Scope = ScopeClass;

/**
 * Holds additional event information.
 */
export type Scope = ScopeInterface;
