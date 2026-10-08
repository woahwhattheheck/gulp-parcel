'use strict';

// Isolated watch-mode regression: no network, Parcel installation or broad suites.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const EventEmitter = require('events');
const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const signals = new EventEmitter();
signals.pid = process.pid;
signals.exit = () => { throw new Error('SIGINT should not fire here'); };
class FakeParcel {
  bundle() { return Promise.resolve({ name: '/fixtures/output.js' }); }
}
class FakePluginError extends Error {
  constructor(name, problem) { super(String(problem)); this.plugin = name; }
}
const fakeFs = {
  readFile(_name, cb) { cb(null, Buffer.from('built')); },
  stat(_name, cb) { cb(null, { size: 5 }); },
};
const context = { module: {exports: {}}, process: signals, Buffer };
context.require = name => {
  if (name === 'parcel-bundler') return FakeParcel;
  if (name === 'plugin-error') return FakePluginError;
  if (name === 'fs') return fakeFs;
  if (name === 'path') return path;
  if (name === 'through2') return {
    obj(transform) {
      const stream = new EventEmitter();
      stream.transform = transform;
      return stream;
    }
  };
  throw new Error('Unexpected dependency ' + name);
};
vm.runInNewContext(source, context, {filename: 'index.js'});
const plugin = context.module.exports;
const runFile = (stream, pathname) => new Promise((resolve, reject) => {
  stream.transform.call(stream, {path: pathname, contents: null}, 'utf8',
    (err, file) => err ? reject(err) : resolve(file));
});
(async () => {
  const watcher = plugin({watch: true, production: false, outDir: '/build'});
  assert.strictEqual(signals.listenerCount('SIGINT'), 0);
  await runFile(watcher, '/fixtures/a.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 1);
  await runFile(watcher, '/fixtures/b.js');
  await runFile(watcher, '/fixtures/c.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 1,
    'three files in a watcher must share one handler');
  watcher.emit('end');
  watcher.emit('close');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'finished watchers must release their process handler');

  const destroyed = plugin({watch: true, production: false, outDir: '/build'});
  await runFile(destroyed, '/fixtures/d.js');
  destroyed.emit('close');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'destroyed watchers must release the handler');

  const normal = plugin({watch: false, production: false, outDir: '/build'});
  await runFile(normal, '/fixtures/e.js');
  assert.strictEqual(signals.listenerCount('SIGINT'), 0,
    'nonwatch builds still release after each completion');
  console.log('Focused watcher signal lifecycle regression passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
