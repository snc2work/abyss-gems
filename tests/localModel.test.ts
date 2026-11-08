import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { LOCAL_MODELS, LocalWorldModel } from '../src/model/localModel';
import type { ModelReply, ModelRequest } from '../src/model/protocol';

// The fixtures hold the Python model server's replies (CPU) for every move of
// docs/samples/sample-game.jsonl. They are written by the training
// project's export script, together with the ONNX files.
interface Fixture {
  cases: { request: ModelRequest; reply: ModelReply }[];
}

ort.env.wasm.numThreads = 1;

describe.each(LOCAL_MODELS.map((model) => model.id))('the shipped model %s', (id) => {
  it('gives the same replies as the Python model server', async () => {
    const model = await LocalWorldModel.load(ort, async (part) => new Uint8Array(readFileSync(`public/models/${id}/${part}.onnx`)));
    const fixture = JSON.parse(readFileSync(`tests/fixtures/world-model-${id}.json`, 'utf8')) as Fixture;
    expect(fixture.cases.length).toBeGreaterThan(20);
    for (const [index, { request, reply }] of fixture.cases.entries()) {
      expect(await model.reply(request), `move ${index}`).toEqual(reply);
    }
  }, 60000);
});
