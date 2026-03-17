// Improved test agent that simulates a real terminal
import WebSocket from 'ws';
import * as readline from 'readline';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000/ws/agent';
const AGENT_ID = process.env.AGENT_ID || 'test-agent-' + Date.now();
const USER_ID = parseInt(process.env.USER_ID || '1', 10);

console.log(`Connecting to ${SERVER_URL}...`);
console.log(`Agent ID: ${AGENT_ID}`);
console.log(`User ID: ${USER_ID}`);

const ws = new WebSocket(SERVER_URL);

// Simulated terminal state per session
const sessions = new Map<string, {
  buffer: string;
  history: string[];
  historyIndex: number;
}>();

function createSession(): { buffer: string; history: string[]; historyIndex: number } {
  return {
    buffer: '',
    history: [],
    historyIndex: -1,
  };
}

function processInput(sessionId: string, data: string): string {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession();
    sessions.set(sessionId, session);
  }

  let output = '';

  // Handle special characters
  if (data === '\r' || data === '\n') {
    // Enter key - execute command
    const command = session.buffer.trim();
    output += '\r\n';

    if (command) {
      session.history.push(command);
      session.historyIndex = session.history.length;

      // Simulate some commands
      if (command.toLowerCase() === 'cls' || command.toLowerCase() === 'clear') {
        // Clear screen - send ANSI clear code
        output += '\x1b[2J\x1b[H';
      } else if (command.toLowerCase() === 'help') {
        output += 'Available commands:\r\n';
        output += '  help    - Show this help\r\n';
        output += '  cls     - Clear screen\r\n';
        output += '  echo    - Echo arguments\r\n';
        output += '  date    - Show current date/time\r\n';
        output += '  whoami  - Show current user\r\n';
        output += '  exit    - Close session\r\n';
      } else if (command.toLowerCase().startsWith('echo ')) {
        output += command.substring(5) + '\r\n';
      } else if (command.toLowerCase() === 'date') {
        output += new Date().toString() + '\r\n';
      } else if (command.toLowerCase() === 'whoami') {
        output += 'TestUser\r\n';
      } else if (command.toLowerCase() === 'exit') {
        output += 'Goodbye!\r\n';
      } else {
        output += `'${command.split(' ')[0]}' is not recognized as a command.\r\n`;
      }
    }

    output += 'PS C:\\Users\\Test> ';
    session.buffer = '';
  } else if (data === '\x7f' || data === '\b') {
    // Backspace/Delete
    if (session.buffer.length > 0) {
      session.buffer = session.buffer.slice(0, -1);
      output += '\b \b'; // Move back, clear, move back
    }
  } else if (data === '\x1b[A') {
    // Up arrow - history previous
    if (session.historyIndex > 0) {
      session.historyIndex--;
      const newLine = session.history[session.historyIndex];
      // Clear current line and write new one
      output += '\rPS C:\\Users\\Test> ' + newLine;
      session.buffer = newLine;
    }
  } else if (data === '\x1b[B') {
    // Down arrow - history next
    if (session.historyIndex < session.history.length - 1) {
      session.historyIndex++;
      const newLine = session.history[session.historyIndex];
      output += '\rPS C:\\Users\\Test> ' + newLine;
      session.buffer = newLine;
    } else if (session.historyIndex === session.history.length - 1) {
      session.historyIndex = session.history.length;
      output += '\rPS C:\\Users\\Test> ';
      session.buffer = '';
    }
  } else if (data === '\x03') {
    // Ctrl+C
    output += '^C\r\nPS C:\\Users\\Test> ';
    session.buffer = '';
  } else if (data === '\x0c') {
    // Ctrl+L - clear screen
    output += '\x1b[2J\x1b[HPS C:\\Users\\Test> ' + session.buffer;
  } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
    // Printable character
    session.buffer += data;
    output += data;
  } else if (data === '\t') {
    // Tab - simple completion
    output += '    '; // Just insert spaces for now
    session.buffer += '    ';
  }

  return output;
}

ws.on('open', () => {
  console.log('Connected! Registering...');

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
  console.log('Received:', msg.type);

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
      sessions.set(msg.sessionId, createSession());

      ws.send(JSON.stringify({
        type: 'session:started',
        sessionId: msg.sessionId,
        payload: { success: true },
        timestamp: Date.now(),
      }));

      // Send welcome message
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'session:output',
          sessionId: msg.sessionId,
          payload: { data: 'Windows PowerShell\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n\r\nTry "help" for available commands.\r\n\r\nPS C:\\Users\\Test> ' },
          timestamp: Date.now(),
        }));
      }, 100);
      break;

    case 'session:input':
      const output = processInput(msg.sessionId, msg.payload.data);
      if (output) {
        ws.send(JSON.stringify({
          type: 'session:output',
          sessionId: msg.sessionId,
          payload: { data: output },
          timestamp: Date.now(),
        }));
      }
      break;

    case 'session:resize':
      console.log('Resize:', msg.payload);
      break;

    case 'session:close':
      console.log('Session closed:', msg.sessionId);
      sessions.delete(msg.sessionId);
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

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  ws.close();
  process.exit(0);
});