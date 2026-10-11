export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingKind =
  'static' | 'potential' | 'inconclusive' | 'informational';
export interface Location {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
export interface Diagnostic {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  kind: FindingKind;
  message: string;
  explanation: string;
  remediation: string;
  documentationUrl: string;
  location: Location;
  relatedLocations: Location[];
}
export interface SuppressedDiagnostic {
  diagnostic: Diagnostic;
  reason: string;
  source: 'inline' | 'configuration';
}
export interface RuleDefinition {
  id: string;
  title: string;
  severity: Severity;
  explanation: string;
  remediation: string;
  documentationUrl: string;
}
export interface Config {
  include?: string[];
  exclude?: string[];
  rules?: Record<string, 'off' | Severity>;
  suppressions?: { ruleId: string; file: string; reason?: string }[];
  electronVersion?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
export interface ScanOptions {
  root?: string;
  configFile?: string;
  config?: Config;
}
export interface Endpoint {
  role: 'main' | 'renderer';
  method: string;
  channel: string | null;
  location: Location;
}
export interface ScanReport {
  schemaVersion: 1;
  toolVersion: string;
  root: string;
  files: string[];
  endpoints: Endpoint[];
  diagnostics: Diagnostic[];
  suppressed: SuppressedDiagnostic[];
  observations: string[];
  complete: boolean;
}
