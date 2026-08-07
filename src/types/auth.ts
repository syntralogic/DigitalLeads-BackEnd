export interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'MANAGER' | 'VIEWER' | 'API_ONLY';
  avatar: string | null;
  createdAt: string;
  lastLogin: string | null;
  twoFactorEnabled: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  user: User;
  token: string;
  expiresIn: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: 'ADMIN' | 'MANAGER' | 'VIEWER';
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  avatar?: string | null;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}