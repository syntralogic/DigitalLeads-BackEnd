export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  errors?: ApiError[];
}

export interface ApiError {
  path: string;
  message: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiKey {
  id: string;
  label: string;
  keyHash: string;
  lastUsed: string | null;
  createdAt: string;
  revoked: boolean;
}

export interface ApiKeyCreateResponse {
  id: string;
  label: string;
  key: string;
  createdAt: string;
}

export interface ApiHealth {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  version: string;
  memory?: {
    used: number;
    total: number;
    heap: number;
  };
  services?: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
  };
}

export interface ApiMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: string;
  labels?: Record<string, string>;
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: any;
  signature?: string;
}

export interface ApiFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'between';
  value: any;
}

export interface ApiSort {
  field: string;
  order: 'asc' | 'desc';
}

export interface ApiQuery {
  filters?: ApiFilter[];
  sort?: ApiSort[];
  page?: number;
  pageSize?: number;
  search?: string;
  fields?: string[];
  include?: string[];
}