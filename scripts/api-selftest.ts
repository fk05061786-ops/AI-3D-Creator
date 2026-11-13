/**
 * Self-test for the Universal API Manager. Runs in node with a stubbed fetch,
 * so no network calls, API keys or paid credits are used.
 */
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  extractModelUrl,
  normalizeSpaceUrl,
  validateModelBytes,
} from '../src/ai/util';
import { LocalProvider } from '../src/ai/providers/local';
import { GradioProvider } from '../src/ai/providers/gradio';
import { CustomRestProvider } from '../src/ai/providers/custom';
import type { GenerationInput, ProviderConfig } from '../src/ai/types';

const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00]);
const glbBase64 = bytesToBase64(glb);

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

await check('normalizeSpaceUrl converts huggingface space URLs', () => {
  assert.equal(
    normalizeSpaceUrl('https://huggingface.co/spaces/stabilityai/TripoSR/'),
    'https://stabilityai-triposr.hf.space'
  );
  assert.equal(normalizeSpaceUrl('https://space.hf.space/'), 'https://space.hf.space');
  assert.equal(normalizeSpaceUrl('space.hf.space'), 'https://space.hf.space');
  assert.equal(normalizeSpaceUrl(''), '');
});

await check('extractModelUrl scans nested Gradio output', () => {
  assert.equal(
    extractModelUrl([{ path: '/tmp/a.txt' }, [{ url: 'https://cdn.test/out.glb?sig=1' }, 'no']]),
    'https://cdn.test/out.glb?sig=1'
  );
  assert.equal(extractModelUrl('data:application/octet-stream;base64,AAAA'), 'data:application/octet-stream;base64,AAAA');
  assert.equal(extractModelUrl('https://cdn.test/out.zip'), null);
  assert.equal(extractModelUrl(null), null);
});

await check('validateModelBytes accepts GLB and glTF JSON only', () => {
  assert.equal(validateModelBytes(glb).kind, 'glb');
  assert.equal(validateModelBytes(new Uint8Array(4)).ok, false);
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, meshes: [{}] }));
  assert.equal(validateModelBytes(json).kind, 'gltf');
  const html = new TextEncoder().encode('<html>not a model</html>');
  assert.equal(validateModelBytes(html).ok, false);
  assert.match(validateModelBytes(html).reason ?? '', /not a GLB/);
});

await check('base64 round-trip preserves bytes', () => {
  assert.deepEqual([...base64ToBytes(glbBase64)], [...glb]);
  assert.deepEqual([...base64ToBytes(`data:model/gltf-binary;base64,${glbBase64}`)], [...glb]);
});

const localConfig: ProviderConfig = { id: 'local', kind: 'local', name: 'Local', baseUrl: 'https://local.test' };
const input: GenerationInput = { prompt: 'chair', pipeline: 'text-to-3d' };

await check('local provider labels placeholder geometry as demo', async () => {
  const restore = installFetch((url) => {
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', gpu_available: false });
    return Response.json({
      success: true,
      data: glbBase64,
      filename: 'demo.glb',
      model_used: 'Local demo box',
      model_info: { note: 'Placeholder demo geometry' },
    });
  });
  try {
    const provider = new LocalProvider();
    const test = await provider.test(localConfig, '');
    assert.equal(test.ok, true);
    const result = await provider.generate(localConfig, '', input, () => {});
    assert.equal(result.demo, true);
    assert.equal(result.genuineAI, false);
    assert.equal(result.filename, 'demo.glb');
  } finally {
    restore();
  }
});

await check('local provider honours an explicit is_ai flag', async () => {
  const restore = installFetch((url) => {
    if (url.endsWith('/health')) return Response.json({ status: 'healthy' });
    return Response.json({ success: true, data: glbBase64, model_used: 'Neural', model_info: { is_ai: true } });
  });
  try {
    const result = await new LocalProvider().generate(localConfig, '', input, () => {});
    assert.equal(result.genuineAI, true);
    assert.equal(result.demo, false);
  } finally {
    restore();
  }
});

await check('gradio provider discovers endpoint, polls SSE and downloads GLB', async () => {
  const space = 'https://demo-space.hf.space';
  const sse = [
    'event: heartbeat',
    'data: null',
    '',
    'event: complete',
    'data: [{"url":"https://cdn.test/generated/model.glb"}]',
    '',
    '',
  ].join('\n');
  const restore = installFetch((url, init) => {
    if (url === `${space}/gradio_api/info`) return new Response('nope', { status: 404 });
    if (url === `${space}/info`) {
      return Response.json({
        named_endpoints: { '/generate': { parameters: [{ parameter_name: 'prompt' }] } },
      });
    }
    if (url === `${space}/call/generate` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { data: unknown[] };
      assert.equal(body.data[0], 'chair');
      return Response.json({ event_id: 'evt1' });
    }
    if (url === `${space}/call/generate/evt1`) return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    if (url === 'https://cdn.test/generated/model.glb') return new Response(glb);
    return new Response('unexpected', { status: 500 });
  });
  try {
    const config: ProviderConfig = { id: 'g', kind: 'gradio', name: 'Space', baseUrl: space, promptArg: 0, imageArg: 0, resultArg: -1 };
    const provider = new GradioProvider();
    const test = await provider.test(config, '');
    assert.equal(test.ok, true);
    const result = await provider.generate(config, '', input, () => {});
    assert.equal(result.genuineAI, true);
    assert.equal(result.demo, false);
    assert.equal(result.filename, 'model.glb');
    assert.equal(result.bytes.byteLength, glb.byteLength);
  } finally {
    restore();
  }
});

await check('gradio provider uploads images and resolves relative files', async () => {
  const space = 'https://image-space.hf.space';
  const sse = 'event: complete\ndata: ["/tmp/gradio/output.glb"]\n\n';
  let uploaded = false;
  const restore = installFetch((url, init) => {
    if (url === `${space}/gradio_api/info`) {
      return Response.json({ named_endpoints: { '/generate': { parameters: [{ parameter_name: 'image' }] } } });
    }
    if (url === `${space}/gradio_api/upload`) {
      uploaded = true;
      assert.ok(init?.body instanceof FormData);
      return Response.json(['/tmp/gradio/source.png']);
    }
    if (url === `${space}/gradio_api/call/generate`) {
      const body = JSON.parse(String(init?.body)) as { data: Array<{ path?: string }> };
      assert.equal(body.data[0].path, '/tmp/gradio/source.png');
      return Response.json({ event_id: 'evt2' });
    }
    if (url === `${space}/gradio_api/call/generate/evt2`) {
      return new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url === `${space}/tmp/gradio/output.glb`) return new Response(glb);
    return new Response('unexpected', { status: 500 });
  });
  try {
    const config: ProviderConfig = { id: 'g2', kind: 'gradio', name: 'Space', baseUrl: space, promptArg: 0, imageArg: 0, resultArg: -1 };
    const result = await new GradioProvider().generate(
      config,
      '',
      { prompt: 'photo', pipeline: 'image-to-3d', image: { dataUrl: 'data:image/png;base64,AAAA', name: 'photo.png', mime: 'image/png' } },
      () => {}
    );
    assert.equal(uploaded, true);
    assert.equal(result.bytes.byteLength, glb.byteLength);
  } finally {
    restore();
  }
});

await check('custom REST provider polls an async job and stays neutral without proof', async () => {
  let polls = 0;
  const restore = installFetch((url, init) => {
    if (url === 'https://api.test/health') return Response.json({ ok: true });
    if (url === 'https://api.test/generate' && init?.method === 'POST') {
      return Response.json({ job_id: 'job1', status_url: 'https://api.test/jobs/job1' });
    }
    if (url === 'https://api.test/jobs/job1') {
      polls++;
      return Response.json(
        polls < 2
          ? { status: 'processing' }
          : { status: 'completed', url: 'https://cdn.test/out.glb' }
      );
    }
    if (url === 'https://cdn.test/out.glb') return new Response(glb);
    return new Response('unexpected', { status: 500 });
  });
  try {
    const config: ProviderConfig = { id: 'c', kind: 'custom', name: 'Custom', baseUrl: 'https://api.test/generate' };
    const provider = new CustomRestProvider();
    const test = await provider.test(config, 'secret');
    assert.equal(test.ok, true);
    const result = await provider.generate(config, 'secret', input, () => {});
    assert.equal(polls, 2);
    assert.equal(result.genuineAI, false);
    assert.equal(result.demo, false);
  } finally {
    restore();
  }
});

await check('custom REST provider surfaces job failures', async () => {
  const restore = installFetch((url, init) => {
    if (url === 'https://api.fail/generate' && init?.method === 'POST') {
      return Response.json({ job_id: 'job2' });
    }
    if (url === 'https://api.fail/jobs/job2') return Response.json({ status: 'failed', error: 'out of credits' });
    return new Response('unexpected', { status: 500 });
  });
  try {
    const config: ProviderConfig = { id: 'c2', kind: 'custom', name: 'Custom', baseUrl: 'https://api.fail/generate' };
    await assert.rejects(
      () => new CustomRestProvider().generate(config, '', input, () => {}),
      /failed: out of credits/
    );
  } finally {
    restore();
  }
});

console.log(`\n${passed} checks passed.`);
