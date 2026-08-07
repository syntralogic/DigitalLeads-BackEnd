export interface Network {
  id: string;
  name: string;
  apiUrl: string | null;
  apiKey: string | null;
  postbackUrl: string | null;
  clickIdMapping: string | null;
  payoutMapping: string | null;
  statusMapping: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  apiHealthy: boolean;
  postbackHealthy: boolean;
  lastApiCheck: string | null;
  lastPostbackCheck: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    offers: number;
    clicks: number;
    conversions: number;
  };
}

export interface NetworkInput {
  name: string;
  apiUrl?: string | null;
  apiKey?: string | null;
  postbackUrl?: string | null;
  clickIdMapping?: string | null;
  payoutMapping?: string | null;
  statusMapping?: string | null;
}

export interface NetworkListParams {
  search?: string;
  status?: Network['status'];
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface NetworkTestResult {
  ok: boolean;
  latencyMs?: number;
  responseCode?: number;
  message?: string;
}