import { FastifyInstance } from 'fastify';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// In-memory storage for recent blackbox reports
const blackboxReports: Array<{
  id: string;
  receivedAt: string;
  userAgent: string;
  data: unknown;
}> = [];
const MAX_REPORTS = 20;

// Also save to disk for persistence
const REPORTS_DIR = join(process.cwd(), 'blackbox-reports');

function saveToDisk(report: typeof blackboxReports[0]) {
  try {
    if (!existsSync(REPORTS_DIR)) {
      mkdirSync(REPORTS_DIR, { recursive: true });
    }
    const filePath = join(REPORTS_DIR, `${report.id}.json`);
    writeFileSync(filePath, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('[blackbox] Failed to save to disk:', err);
  }
}

export async function blackboxRoutes(fastify: FastifyInstance) {
  // Receive blackbox data from frontend
  fastify.post('/api/blackbox/report', async (request, reply) => {
    const body = request.body as {
      events?: unknown[];
      startTime?: number;
      label?: string;
    };
    const userAgent = request.headers['user-agent'] || 'unknown';

    const report = {
      id: `bb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: new Date().toISOString(),
      userAgent,
      label: body?.label || 'unnamed',
      eventCount: body?.events?.length || 0,
      data: body,
    };

    blackboxReports.push(report);
    if (blackboxReports.length > MAX_REPORTS) {
      blackboxReports.shift();
    }

    // Save to disk
    saveToDisk(report);

    console.log(`[blackbox] Report received: ${report.id} (${report.eventCount} events, label: ${report.label})`);

    return { ok: true, id: report.id, eventCount: report.eventCount };
  });

  // List recent reports
  fastify.get('/api/blackbox/reports', async () => {
    return {
      reports: blackboxReports.map(r => ({
        id: r.id,
        receivedAt: r.receivedAt,
        label: (r as any).label,
        eventCount: (r as any).eventCount,
        userAgent: r.userAgent,
      })),
    };
  });

  // Get a specific report
  fastify.get('/api/blackbox/report/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = blackboxReports.find(r => r.id === id);
    if (!report) {
      reply.code(404);
      return { error: 'Report not found' };
    }
    return report;
  });

  // Get the latest report
  fastify.get('/api/blackbox/latest', async () => {
    if (blackboxReports.length === 0) {
      return { error: 'No reports yet' };
    }
    return blackboxReports[blackboxReports.length - 1];
  });
}
