import type {
  ClientReport,
  ClientReportEnvelope,
  ClientReportItem,
} from '@xigua-monitor/types';

import { createEnvelope } from './envelope';
import { dateTimestampInSeconds } from './time';

/**
 * 创建客户端报告信封
 * @param discarded_events 代表被丢弃事件的数组
 * @param dsn 数据源名称（DSN）用于标识数据发送的目标位置，例如 Sentry 服务器的地址
 */
export function createClientReportEnvelope(
  discarded_events: ClientReport['discarded_events'],
  dsn?: string,
  timestamp?: number,
): ClientReportEnvelope {
  const clientReportItem: ClientReportItem = [
    { type: 'client_report' },
    {
      timestamp: timestamp || dateTimestampInSeconds(),
      discarded_events,
    },
  ];
  return createEnvelope<ClientReportEnvelope>(dsn ? { dsn } : {}, [
    clientReportItem,
  ]);
}
