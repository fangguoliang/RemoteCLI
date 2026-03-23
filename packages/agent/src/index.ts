import 'dotenv/config';
import { Tunnel } from './tunnel.js';

console.log('remoteCli Agent starting...');

const tunnel = new Tunnel();
tunnel.connect();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  tunnel.disconnect();
  process.exit(0);
});

export { FileManager } from './file.js';