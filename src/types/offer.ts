export interface Offer {
  id: string;
  name: string;
  category: string | null;
  country: string | null;
  deviceTargeting: string | null;
  browserTargeting: string | null;
  payout: number | null;
  dailyCap: number | null;
  hourlyCap: number | null;
  startDate: string | null;
  endDate: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED' | 'EXPIRED';
  networkId: string;
  network?: {
    id: string;
    name: string;
  };
  previewLink: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    clicks: number;
    conversions: number;
  };
}

export interface OfferInput {
  name: string;
  category?: string | null;
  country?: string | null;
  deviceTargeting?: string | null;
  browserTargeting?: string | null;
  payout?: number | null;
  dailyCap?: number | null;
  hourlyCap?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  networkId: string;
}

export interface OfferListParams {
  search?: string;
  status?: Offer['status'];
  category?: string;
  country?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}