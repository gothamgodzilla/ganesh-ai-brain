#!/usr/bin/env node
import { runInfrastructureWatchdog } from '../brain-server/watchdog.mjs';

const report = await runInfrastructureWatchdog();
console.log(
  JSON.stringify(
    {
      id: report.id,
      checkedAt: report.checkedAt,
      totalProperties: report.totalProperties,
      healthyCount: report.healthyCount,
      degradedCount: report.degradedCount,
      downCount: report.downCount,
      anomaliesCount: report.anomaliesCount,
      anomalies: report.anomalies,
    },
    null,
    2
  )
);
