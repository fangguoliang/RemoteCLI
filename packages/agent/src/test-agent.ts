// Simple test agent without node-pty (for testing WebSocket connection)
import WebSocket from 'ws';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000/ws/agent';
const AGENT_ID = process.env.AGENT_ID || 'test-agent-' + Date.now();
const USER_ID = parseInt(process.env.USER_ID || '1', 10);

console.log(`Connecting to ${SERVER_URL}...`);
console.log(`Agent ID: ${AGENT_ID}`);
console.log(`User ID: ${USER_ID}`);

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('Connected! Registering...');

  // Register the agent
  ws.send(JSON.stringify({
    type: 'register',
    payload: {
      agentId: AGENT_ID,
      userId: USER_ID,
      name: 'Test PowerShell Agent',
    },
    timestamp: Date.now(),
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg.type, msg);

  switch (msg.type) {
    case 'register:result':
      if (msg.payload.success) {
        console.log('Registration successful!');
      } else {
        console.error('Registration failed:', msg.payload.error);
      }
      break;

    case 'session:start':
      console.log('Session start requested:', msg.sessionId);
      // Simulate terminal output
      ws.send(JSON.stringify({
        type: 'session:started',
        sessionId: msg.sessionId,
        payload: { success: true },
        timestamp: Date.now(),
      }));

      // Send some simulated output
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'session:output',
          sessionId: msg.sessionId,
          payload: { data: 'Windows PowerShell\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n\r\nPS C:\\Users\\Test> ' },
          timestamp: Date.now(),
        }));
      }, 500);
      break;

    case 'session:input':
      console.log('Input received:', msg.payload.data);
      // Echo back the input
      ws.send(JSON.stringify({
        type: 'session:output',
        sessionId: msg.sessionId,
        payload: { data: msg.payload.data },
        timestamp: Date.now(),
      }));
      break;

    case 'session:resize':
      console.log('Resize:', msg.payload);
      break;

    case 'session:close':
      console.log('Session closed:', msg.sessionId);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;
  }
});

ws.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  ws.close();
  process.exit(0);
});