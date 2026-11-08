// A stand-in world model server for trying the model mode without a trained model.
//   npm run model:mock
//   npm run model:mock -- --errors 0.2 --no-frames

import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { ruleEngine } from '../src/engine';
import type { ModelRequest } from '../src/model/protocol';
import { rulesReply } from '../src/model/rulesModel';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '8765' },
    /** Share of replies with one wrong cell, to see how differences look. */
    errors: { type: 'string', default: '0' },
    'no-frames': { type: 'boolean', default: false },
  },
});
const errorRate = Number(values.errors);

const server = createServer((request, response) => {
  // The game runs on another port, so the browser requires these headers.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/step') {
    response.writeHead(404).end();
    return;
  }

  let body = '';
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    try {
      const reply = rulesReply(ruleEngine, JSON.parse(body) as ModelRequest);
      if (values['no-frames']) delete reply.frames;
      if (Math.random() < errorRate) {
        const row = reply.next_board_self.length - 1;
        reply.next_board_self = reply.next_board_self.map((cells, index) =>
          index === row ? cells.map((cell, col) => (col === 0 ? (cell % 4) + 1 : cell)) : cells,
        );
        delete reply.frames;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain' }).end((error as Error).message);
    }
  });
});

server.listen(Number(values.port), () => {
  console.log(`stand-in model: http://localhost:${values.port}/step (answers with the real rules)`);
});
