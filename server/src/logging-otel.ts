/**
 * OpenTelemetry 日志采集初始化
 *
 * 必须作为应用第一个 import 加载（在 main.ts 顶部），
 * 确保所有 Pino logger 调用都被 OTel instrumentation 拦截。
 *
 * 如果 OTel Collector 不可达，SDK 内部排队重试，不阻塞应用启动。
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const OTEL_COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL || 'http://signoz-otel-collector:4318/v1/logs';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'oceanus-server',
  }),
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter({ url: OTEL_COLLECTOR_URL })),
  instrumentations: [new PinoInstrumentation({})],
});

sdk.start();

// 应用关闭时优雅关闭 SDK
process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error:', err));
});
