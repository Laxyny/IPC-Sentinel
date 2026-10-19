import type { RuleDefinition, Severity } from './types.js';
const definitions: [string, string, Severity, string, string][] = [
  [
    'IPC001',
    'Dangerous IPC bridge exposure',
    'high',
    'A general-purpose bridge, renderer-controlled privileged call or leaked Electron event can weaken the preload boundary.',
    'Expose one method per allowed operation; fix channel names and strip the event argument from callbacks.',
  ],
  [
    'IPC002',
    'Review privileged IPC handler validation',
    'medium',
    'A discovered handler reaches a privileged API. Static evidence cannot establish complete sender and argument validation.',
    'Validate senderFrame against exact trusted origins and validate payloads before privileged operations; review helper control flow.',
  ],
  [
    'IPC003',
    'IPC relationship not discovered',
    'low',
    'A caller has no matching handler in the discovered graph; excluded files or wrappers may explain the gap.',
    'Check the channel and communication method, scan all registration modules, and inspect dynamic wrappers.',
  ],
  [
    'IPC004',
    'Multiple invoke handler registrations',
    'medium',
    'Multiple handle registrations for the same channel may conflict if executed together.',
    'Register each invoke handler once or confirm that registrations are mutually exclusive.',
  ],
  [
    'IPC005',
    'Unsafe explicit Electron preference',
    'high',
    'An explicit BrowserWindow preference weakens an Electron security boundary.',
    'Use isolated, sandboxed renderers with Node integration disabled and web security enabled.',
  ],
  [
    'IPC006',
    'Review external URL handling',
    'medium',
    'An external URL passed to shell.openExternal is not a statically known HTTPS URL.',
    'Parse and allowlist protocols and destinations before opening URLs; review the origin of the value.',
  ],
  [
    'IPC007',
    'Dynamic IPC channel',
    'informational',
    'The channel cannot be reduced to a static string; relationship analysis is inconclusive.',
    'Prefer immutable shared channel constants or manually review the dynamic registration and call sites.',
  ],
  [
    'IPC008',
    'Source analysis incomplete',
    'informational',
    'A source file is malformed, a resource limit was reached, or relevant configuration cannot be resolved.',
    'Resolve the reported limitation and scan again; a partial scan must not be treated as a clean audit.',
  ],
  [
    'IPC009',
    'Insecure remote content',
    'medium',
    'An HTTP destination is loaded without transport protection, or a window-open handler unconditionally permits child windows. Review remote content policy.',
    'Load local trusted content or an HTTPS destination with restrictive navigation and permission policies.',
  ],
];
export const rules: readonly RuleDefinition[] = definitions.map(
  ([id, title, severity, explanation, remediation]) => ({
    id,
    title,
    severity,
    explanation,
    remediation,
    documentationUrl: `https://github.com/Laxyny/IPC-Sentinel/blob/main/docs/rules.md#${id.toLowerCase()}`,
  }),
);
export const severities: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
];
export function getRule(id: string): RuleDefinition {
  const rule = rules.find((rule) => rule.id === id);
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule;
}
