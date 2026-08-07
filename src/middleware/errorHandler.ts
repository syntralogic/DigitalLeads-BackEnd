import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { Prisma } from '@prisma/client';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;
  errors?: any[];

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    code?: string,
    errors?: any[]
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError | Prisma.PrismaClientKnownRequestError,
  req: Request,
  res: Response,
  _next: NextFunction // Add underscore to indicate intentionally unused
): void => { // Add explicit return type void
  // Log error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    path: req.path,
    method: req.method,
    ip: req.ip,
    user: req.user?.id || 'anonymous',
    body: req.body,
    query: req.query,
    params: req.params,
  });

  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        res.status(409).json({
          success: false,
          message: 'Duplicate entry. A record with this value already exists.',
          code: 'DUPLICATE_ENTRY',
          field: err.meta?.target,
        });
        return;
      case 'P2025':
        res.status(404).json({
          success: false,
          message: 'Record not found.',
          code: 'NOT_FOUND',
        });
        return;
      case 'P2003':
        res.status(400).json({
          success: false,
          message: 'Invalid reference. The referenced record does not exist.',
          code: 'INVALID_REFERENCE',
        });
        return;
      default:
        res.status(400).json({
          success: false,
          message: 'Database error occurred.',
          code: err.code,
        });
        return;
    }
  }

  // Handle custom AppError
  if (err instanceof AppError) {
    const response: any = {
      success: false,
      message: err.message,
    };
    if (err.code) response.code = err.code;
    if (err.errors) response.errors = err.errors;
    if (process.env.NODE_ENV === 'development') response.stack = err.stack;

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      message: 'Invalid token.',
      code: 'INVALID_TOKEN',
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      message: 'Token expired. Please login again.',
      code: 'TOKEN_EXPIRED',
    });
    return;
  }

  // Handle validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({
      success: false,
      message: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: (err as any).errors,
    });
    return;
  }

  // Default error
  const statusCode = (err as any).statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    message: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
  return;
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};