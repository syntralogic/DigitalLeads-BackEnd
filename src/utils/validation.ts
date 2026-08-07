import { z } from 'zod';

// Common validation patterns
export const phoneRegex = /^\+?[1-9]\d{1,14}$/;
export const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
export const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

// Custom validators
export const validators = {
  phone: (value: string) => phoneRegex.test(value),
  url: (value: string) => urlRegex.test(value),
  ip: (value: string) => ipRegex.test(value),
  isPositiveNumber: (value: number) => value > 0,
  isNonNegativeNumber: (value: number) => value >= 0,
  isDateInFuture: (value: Date) => new Date(value) > new Date(),
  isDateInPast: (value: Date) => new Date(value) < new Date(),
};

// Common schemas
export const idSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const statusEnum = z.enum(['ACTIVE', 'INACTIVE', 'PENDING']);

// Helper to validate and transform
export function validateAndTransform<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Validation error: ${error.errors.map(e => e.message).join(', ')}`);
    }
    throw error;
  }
}