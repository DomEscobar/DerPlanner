import { Router, Request, Response } from 'express';
import { gmailAuthService } from '../services/gmail-auth-service';
import { gmailSyncService } from '../services/gmail-sync-service';
import { query } from '../config/database';

const router = Router();

/**
 * Middleware: Validate userId
 */
const validateUserId = (req: Request, res: Response, next: Function) => {
  const userId = req.query.userId || req.body.userId;

  if (!userId) {
    res.status(400).json({
      success: false,
      error: 'userId is required',
    });
    return;
  }

  next();
};

// ==================== GMAIL INTEGRATION ====================

/**
 * GET /api/integrations/google/url
 * Generate OAuth authorization URL for Gmail
 */
router.get('/google/url', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    const authUrl = gmailAuthService.generateAuthUrl(userId);

    res.json({
      success: true,
      data: { authUrl },
    });
  } catch (error) {
    console.error('❌ Error generating Gmail auth URL:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate auth URL',
    });
  }
});

/**
 * GET /api/integrations/google/callback
 * Handle OAuth callback from Google
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.warn(`⚠️  OAuth error: ${oauthError}`);
      return res.redirect(`/?integrationStatus=gmail_error&error=${encodeURIComponent(String(oauthError))}`);
    }

    if (!code || !state) {
      return res.redirect('/?integrationStatus=gmail_error&error=Missing code or state');
    }

    const result = await gmailAuthService.exchangeCode(code as string, state as string);

    console.log(`✅ Gmail OAuth completed for user: ${result.userId}`);

    return res.redirect(
      `/?integrationStatus=gmail_connected&userId=${encodeURIComponent(result.userId)}`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in Gmail callback:', errorMsg);

    return res.redirect(`/?integrationStatus=gmail_error&error=${encodeURIComponent(errorMsg)}`);
  }
});

/**
 * POST /api/integrations/google/sync
 * Manually trigger Gmail sync
 */
router.post('/google/sync', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    const integration = await gmailAuthService.getIntegrationStatus(userId);

    if (!integration) {
      res.status(404).json({
        success: false,
        error: 'Gmail integration not found. Please connect Gmail first.',
      });
      return;
    }

    if (integration.sync_status === 'syncing') {
      res.status(409).json({
        success: false,
        error: 'Sync already in progress',
      });
      return;
    }

    gmailSyncService.incrementalSync(userId).catch(err => {
      console.error('Background sync error:', err);
    });

    res.json({
      success: true,
      message: 'Sync initiated in background',
    });
  } catch (error) {
    console.error('❌ Error triggering sync:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sync failed',
    });
  }
});

/**
 * DELETE /api/integrations/google/disconnect
 * Disconnect Gmail integration
 */
router.delete('/google/disconnect', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    await gmailAuthService.disconnect(userId);

    res.json({
      success: true,
      message: 'Gmail disconnected successfully',
    });
  } catch (error) {
    console.error('❌ Error disconnecting Gmail:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Disconnect failed',
    });
  }
});

/**
 * GET /api/integrations/google/status
 * Get Gmail integration status
 */
router.get('/google/status', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    const integration = await gmailAuthService.getIntegrationStatus(userId);

    if (!integration) {
      res.json({
        success: true,
        data: {
          connected: false,
        },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        connected: true,
        syncStatus: integration.sync_status,
        lastSyncAt: integration.last_sync_at,
        syncError: integration.sync_error,
        historyId: integration.history_id,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed',
    });
  }
});

/**
 * POST /api/integrations/google/preferences
 * Update Gmail sync preferences (labels, filters)
 */
router.post('/google/preferences', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;
    const { labelFilters } = req.body;

    if (!Array.isArray(labelFilters)) {
      res.status(400).json({
        success: false,
        error: 'labelFilters must be an array',
      });
      return;
    }

    await query(
      'UPDATE gmail_integrations SET label_filters = $1 WHERE user_id = $2',
      [JSON.stringify(labelFilters), userId]
    );

    res.json({
      success: true,
      message: 'Preferences updated',
    });
  } catch (error) {
    console.error('❌ Error updating preferences:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update preferences',
    });
  }
});

/**
 * GET /api/integrations/google/synced-events
 * Get events synced from Gmail for a user
 */
router.get('/google/synced-events', validateUserId, async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 50;

    const result = await query(
      `SELECT id, title, start_date, end_date, location, sync_source, external_id 
       FROM events 
       WHERE user_id = $1 AND sync_source = 'gmail'
       ORDER BY start_date DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('❌ Error fetching synced events:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch synced events',
    });
  }
});

export default router;

