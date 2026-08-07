export interface RoutingRule {
  id: string;
  name: string;
  type: RoutingType;
  conditions: RoutingConditions;
  weight: number;
  targetOfferId: string | null;
  targetOffer?: {
    id: string;
    name: string;
  } | null;
  backupOfferId: string | null;
  backupOffer?: {
    id: string;
    name: string;
  } | null;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RoutingType = 'COUNTRY' | 'DEVICE' | 'BROWSER' | 'OS' | 'WEIGHT';

export interface RoutingConditions {
  country?: string | string[];
  device?: string | string[];
  browser?: string | string[];
  os?: string | string[];
  isp?: string | string[];
  city?: string | string[];
  region?: string | string[];
  timezone?: string | string[];
  language?: string | string[];
  dayOfWeek?: number | number[];
  hourOfDay?: number | number[];
  ipRange?: {
    start: string;
    end: string;
  }[];
  referrer?: string | string[];
  campaign?: string | string[];
  custom?: Record<string, any>;
}

export interface RoutingRuleCreateInput {
  name: string;
  type: RoutingType;
  conditions: RoutingConditions;
  weight?: number;
  targetOfferId?: string;
  backupOfferId?: string;
  priority?: number;
  enabled?: boolean;
}

export interface RoutingRuleUpdateInput {
  name?: string;
  type?: RoutingType;
  conditions?: RoutingConditions;
  weight?: number;
  targetOfferId?: string | null;
  backupOfferId?: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface RoutingDecision {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  targetOfferId: string | null;
  backupOfferId: string | null;
  weight: number;
  conditions: RoutingConditions;
  reason?: string;
}

export interface RoutingResult {
  offerId: string;
  backupOfferId: string | null;
  ruleId: string;
  ruleName: string;
  matched: boolean;
  details: RoutingDecision;
}

export interface RoutingTestParams {
  country?: string;
  device?: string;
  browser?: string;
  os?: string;
  isp?: string;
  city?: string;
  ip?: string;
  referrer?: string;
  campaign?: string;
}

export interface RoutingStats {
  totalRules: number;
  enabledRules: number;
  disabledRules: number;
  matchedRules: number;
  unmatchedRules: number;
  byType: Record<RoutingType, number>;
  byPriority: Array<{
    priority: number;
    count: number;
  }>;
  topRules: Array<{
    id: string;
    name: string;
    matches: number;
  }>;
}