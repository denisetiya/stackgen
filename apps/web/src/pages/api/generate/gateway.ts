import type { APIRoute } from 'astro';
import { generateGateway, bundleZip, GatewayConfigSchema } from '@stackgen/core';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body = await request.json();
    const config = GatewayConfigSchema.parse(body);
    let files = generateGateway(config);

    files = files.map(f =>
      f.path === 'README.md' ? { ...f, content: f.content.replace('{{generatedAt}}', new Date().toISOString()) } : f
    );

    const format = url.searchParams.get('format');

    if (format === 'zip') {
      const buf = await bundleZip(files);
      return new Response(buf, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="stackgen-gateway.zip"`,
        },
      });
    }

    return new Response(JSON.stringify({ files }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Generation failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
