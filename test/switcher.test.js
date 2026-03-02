import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';

async function load() {
  return import(`../src/switcher.js?t=${Date.now()}-${Math.random()}`);
}

function startServer(port, response) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200);
      res.end(response);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

describe('switcher', () => {
  let server;

  afterEach((_, done) => {
    if (server) {
      server.close(() => {
        server = null;
        done();
      });
    } else {
      done();
    }
  });

  describe('isMetroRunning', () => {
    it('returns true when Metro responds with packager-status:running', async () => {
      server = await startServer(0, 'packager-status:running');
      const port = server.address().port;
      const { isMetroRunning } = await load();

      const result = await isMetroRunning(port);
      assert.equal(result, true);
    });

    it('returns false when Metro responds with different status', async () => {
      server = await startServer(0, 'not-metro');
      const port = server.address().port;
      const { isMetroRunning } = await load();

      const result = await isMetroRunning(port);
      assert.equal(result, false);
    });

    it('returns false when nothing is listening', async () => {
      const { isMetroRunning } = await load();
      // Use a port that's very unlikely to be in use
      const result = await isMetroRunning(19999);
      assert.equal(result, false);
    });
  });

  describe('switchPort', () => {
    it('throws for unknown platform', async () => {
      const { switchPort } = await load();
      assert.throws(
        () => switchPort('com.test', 8081, 'windows'),
        /Unknown platform: windows/
      );
    });
  });
});
