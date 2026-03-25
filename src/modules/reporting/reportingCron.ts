// src/modules/reporting/reportingCron.ts
// Daily digest reporting cron: triggers reportDailyDigest at 00:00 UTC.

import cron from 'node-cron';
import { reportDailyDigest } from './sheetsReporter';

export function startReportingCron(): void {
  // Every day at 00:00 UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('[Reporting] Triggering daily digest...');
    await reportDailyDigest();
  });

  console.log('[Reporting] Daily digest cron scheduled (00:00 UTC).');
}
