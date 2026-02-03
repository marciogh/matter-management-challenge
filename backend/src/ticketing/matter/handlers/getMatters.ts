import { Request, Response } from 'express';
import { MatterService } from '../service/matter_service.js';
import { z } from 'zod';
import logger from '../../../utils/logger.js';

const VALID_SORT_FIELDS = [
  'created_at', 'updated_at', 'subject',
  'Case Number', 'Status', 'Assigned To', 'Priority',
  'Contract Value', 'Due Date', 'Urgent',
  'resolutionTime', 'sla',
];

const querySchema = z.object({
  page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 25)),
  sortBy: z.enum(VALID_SORT_FIELDS as [string, ...string[]]).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  search: z.string().optional().default(''),
});

export async function getMatters(req: Request, res: Response): Promise<void> {
  try {
    const params = querySchema.parse(req.query);
    
    const matterService = new MatterService();
    const result = await matterService.getMatters(params);

    res.json(result);
  } catch (error) {
    logger.error('Error fetching matters', { error });
    
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: error.errors,
      });
      return;
    }

    res.status(500).json({ error: 'Internal server error' });
  }
}

