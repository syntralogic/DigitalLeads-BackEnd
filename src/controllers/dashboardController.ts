// src/controllers/dashboardController.ts
import { Request, Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboardService';
import { logger } from '../config/logger';

type DashboardRange = 'today' | '7d' | '30d' | '90d';

export class DashboardController {
  // ✅ Use _ to indicate unused parameters
  static async getKpis(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      const range = (req.query.range as DashboardRange) || 'today';
      
      // Validate range
      const validRanges = ['today', '7d', '30d', '90d'];
      if (!validRanges.includes(range)) {
        res.status(400).json({ 
          success: false, 
          message: 'Invalid range parameter. Use: today, 7d, 30d, or 90d' 
        });
        return;
      }

      // Use DashboardService
      const kpis = await DashboardService.getKpis(range);
      res.json(kpis);
    } catch (error) {
      logger.error('Dashboard KPIs error:', error);
      // Return empty KPIs instead of error to prevent UI breaking
      res.json({
        liveClicks: 0,
        uniqueClicks: 0,
        conversions: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        revenue: 0,
        epc: 0,
        conversionRate: 0,
        redirectRate: 0,
      });
    }
  }

  // ✅ Use _ for unused parameters
  static async getSeries(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const metric = req.params.metric;
    const range = (req.query.range as DashboardRange) || 'today';

    try {
      const validMetrics = ['revenue', 'clicks', 'conversions', 'traffic', 'performance'];
      if (!validMetrics.includes(metric)) {
        res.status(400).json({ error: 'Invalid metric parameter' });
        return;
      }

      // Use DashboardService
      const series = await DashboardService.getSeries(metric, range);
      res.json(series);
    } catch (error) {
      logger.error(`Dashboard series error for metric ${metric}:`, error);
      // Return empty array on error
      res.json([]);
    }
  }

  // ✅ Use _ for unused parameters
  static async getBreakdown(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const dimension = req.params.dimension;
    const range = (req.query.range as DashboardRange) || 'today';

    try {
      const validDimensions = ['offers', 'networks', 'sources', 'countries', 'devices', 'browsers', 'os'];
      if (!validDimensions.includes(dimension)) {
        res.status(400).json({ error: 'Invalid dimension parameter' });
        return;
      }

      // Use DashboardService
      const breakdown = await DashboardService.getBreakdown(dimension, range);
      res.json(breakdown);
    } catch (error) {
      logger.error(`Dashboard breakdown error for dimension ${dimension}:`, error);
      // Return empty array on error
      res.json([]);
    }
  }

  // ✅ Use _ for unused parameters
  static async getLiveActivity(_req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      // Use DashboardService
      const activities = await DashboardService.getLiveActivity();
      res.json(activities);
    } catch (error) {
      logger.error('Dashboard live activity error:', error);
      // Return empty array on error
      res.json([]);
    }
  }

  // ✅ Use _ for unused parameters
  static async getAIRecommendations(_req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      // Use DashboardService
      const recommendations = await DashboardService.getAIRecommendations();
      res.json(recommendations);
    } catch (error) {
      logger.error('Dashboard AI recommendations error:', error);
      // Return empty array on error
      res.json([]);
    }
  }
}