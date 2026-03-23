// Improved test agent that simulates a real terminal
import WebSocket from 'ws';

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
  currentDrive: string;
  currentPath: string;
  variables: Map<string, string>;
}>();

function createSession(): ReturnType<typeof sessions.get> {
  return {
    buffer: '',
    history: [],
    historyIndex: -1,
    currentDrive: 'C',
    currentPath: '\\Users\\Test',
    variables: new Map([
      ['PATH', 'C:\\Windows\\System32;C:\\Windows'],
      ['USERNAME', 'TestUser'],
      ['COMPUTERNAME', 'TESTPC'],
      ['USERPROFILE', 'C:\\Users\\Test'],
    ]),
  };
}

function getPrompt(session: NonNullable<ReturnType<typeof createSession>>): string {
  return `${session.currentDrive}:${session.currentPath}> `;
}

function normalizePath(path: string, session: NonNullable<ReturnType<typeof createSession>>): string {
  // Handle relative paths
  if (!path.includes(':') && !path.startsWith('\\')) {
    path = session.currentPath + '\\' + path;
  }
  // Handle ..
  while (path.includes('\\..')) {
    path = path.replace(/\\[^\\]+\\\.\./, '');
  }
  // Handle .
  path = path.replace(/\\\./g, '');
  // Normalize slashes
  path = path.replace(/\\\\/g, '\\');
  if (!path.startsWith('\\')) {
    path = '\\' + path;
  }
  return path;
}

function processCommand(command: string, session: NonNullable<ReturnType<typeof createSession>>): string {
  const args = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd = (args[0] || '').toLowerCase();
  const cmdArgs = args.slice(1);

  let output = '';

  switch (cmd) {
    case 'help':
      output += 'Available commands:\r\n';
      output += '  help          - Show this help\r\n';
      output += '  cls / clear   - Clear screen\r\n';
      output += '  echo [text]   - Display text\r\n';
      output += '  cd [path]     - Change directory\r\n';
      output += '  pwd           - Print working directory\r\n';
      output += '  dir / ls      - List directory contents\r\n';
      output += '  mkdir [name]  - Create directory\r\n';
      output += '  type [file]   - Display file contents\r\n';
      output += '  set           - Show environment variables\r\n';
      output += '  date          - Show current date/time\r\n';
      output += '  time          - Show current time\r\n';
      output += '  whoami        - Show current user\r\n';
      output += '  hostname      - Show computer name\r\n';
      output += '  ver           - Show version\r\n';
      output += '  exit          - Close session\r\n';
      break;

    case 'cls':
    case 'clear':
      output += '\x1b[2J\x1b[H';
      break;

    case 'echo':
      output += cmdArgs.join(' ').replace(/^"|"$/g, '') + '\r\n';
      break;

    case 'cd':
      if (cmdArgs.length === 0) {
        output += session.currentPath + '\r\n';
      } else {
        let newPath = cmdArgs[0].replace(/^"|"$/g, '');

        // Handle drive letter (e.g., "d:")
        if (newPath.length === 2 && newPath[1] === ':') {
          session.currentDrive = newPath[0].toUpperCase();
          session.currentPath = '\\';
          output += `Changed drive to ${session.currentDrive}:\r\n`;
        } else if (newPath === '\\' || newPath === '/') {
          session.currentPath = '\\';
        } else if (newPath === '..') {
          const parts = session.currentPath.split('\\').filter(p => p);
          parts.pop();
          session.currentPath = '\\' + parts.join('\\');
          if (session.currentPath === '\\') session.currentPath = '\\';
        } else {
          session.currentPath = normalizePath(newPath, session);
        }
      }
      break;

    case 'pwd':
      output += `${session.currentDrive}:${session.currentPath}\r\n`;
      break;

    case 'dir':
    case 'ls':
      output += `\r\n Volume in drive ${session.currentDrive} has no label.\r\n`;
      output += ` Volume Serial Number is XXXX-XXXX\r\n\r\n`;
      output += ` Directory of ${session.currentDrive}:${session.currentPath}\r\n\r\n`;
      output += '01/15/2024  09:30 AM    <DIR>          .\r\n';
      output += '01/15/2024  09:30 AM    <DIR>          ..\r\n';
      output += '01/15/2024  09:30 AM    <DIR>          Desktop\r\n';
      output += '01/15/2024  09:30 AM    <DIR>          Documents\r\n';
      output += '01/15/2024  09:30 AM    <DIR>          Downloads\r\n';
      output += '01/15/2024  09:30 AM    1,234 readme.txt\r\n';
      output += '01/15/2024  09:30 AM    5,678 test.ps1\r\n';
      output += '               2 File(s)          6,912 bytes\r\n';
      output += '               5 Dir(s)   100,000,000,000 bytes free\r\n';
      break;

    case 'mkdir':
    case 'md':
      if (cmdArgs.length > 0) {
        output += `Directory created: ${cmdArgs[0]}\r\n`;
      } else {
        output += 'The syntax of the command is incorrect.\r\n';
      }
      break;

    case 'type':
      if (cmdArgs.length > 0) {
        const file = cmdArgs[0].toLowerCase();
        if (file.includes('readme')) {
          output += 'This is a test file.\r\n';
          output += 'remoteCli Test Agent\r\n';
        } else if (file.includes('.ps1')) {
          output += 'Write-Host "Hello from PowerShell!"\r\n';
          output += 'Get-Date\r\n';
        } else {
          output += `The system cannot find the file specified: ${cmdArgs[0]}\r\n`;
        }
      } else {
        output += 'The syntax of the command is incorrect.\r\n';
      }
      break;

    case 'set':
      if (cmdArgs.length === 0) {
        session.variables.forEach((value, key) => {
          output += `${key}=${value}\r\n`;
        });
      } else {
        const [keyVal, ...rest] = cmdArgs.join(' ').split('=');
        if (keyVal) {
          session.variables.set(keyVal.trim(), rest.join('=').trim());
        }
      }
      break;

    case 'date':
      output += new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }) + '\r\n';
      break;

    case 'time':
      output += new Date().toLocaleTimeString('en-US', { hour12: false }) + '\r\n';
      break;

    case 'whoami':
      output += `${session.variables.get('COMPUTERNAME')}\\${session.variables.get('USERNAME')}\r\n`;
      break;

    case 'hostname':
      output += session.variables.get('COMPUTERNAME') + '\r\n';
      break;

    case 'ver':
      output += '\r\nMicrosoft Windows [Version 10.0.19045.3803]\r\n';
      break;

    case 'ipconfig':
      output += '\r\nWindows IP Configuration\r\n\r\n';
      output += 'Ethernet adapter Ethernet:\r\n\r\n';
      output += '   Connection-specific DNS Suffix  . : \r\n';
      output += '   IPv4 Address. . . . . . . . . . . : 192.168.1.100\r\n';
      output += '   Subnet Mask . . . . . . . . . . . : 255.255.255.0\r\n';
      output += '   Default Gateway . . . . . . . . . : 192.168.1.1\r\n';
      break;

    case 'systeminfo':
      output += '\r\nHost Name:                 ' + session.variables.get('COMPUTERNAME') + '\r\n';
      output += 'OS Name:                   Microsoft Windows 10 Pro\r\n';
      output += 'OS Version:                10.0.19045 Build 19045\r\n';
      output += 'System Type:               x64-based PC\r\n';
      break;

    case 'exit':
      output += 'Goodbye!\r\n';
      break;

    case '':
      // Empty command
      break;

    default:
      output += `'${cmd}' is not recognized as an internal or external command,\r\n`;
      output += `operable program or batch file.\r\n`;
  }

  return output;
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
      output += processCommand(command, session);
    }

    output += getPrompt(session);
    session.buffer = '';
  } else if (data === '\x7f' || data === '\b') {
    // Backspace/Delete
    if (session.buffer.length > 0) {
      session.buffer = session.buffer.slice(0, -1);
      output += '\b \b';
    }
  } else if (data === '\x1b[A') {
    // Up arrow
    if (session.historyIndex > 0) {
      session.historyIndex--;
      const newLine = session.history[session.historyIndex];
      output += '\r' + getPrompt(session) + newLine;
      session.buffer = newLine;
    }
  } else if (data === '\x1b[B') {
    // Down arrow
    if (session.historyIndex < session.history.length - 1) {
      session.historyIndex++;
      const newLine = session.history[session.historyIndex];
      output += '\r' + getPrompt(session) + newLine;
      session.buffer = newLine;
    } else if (session.historyIndex === session.history.length - 1) {
      session.historyIndex = session.history.length;
      output += '\r' + getPrompt(session);
      session.buffer = '';
    }
  } else if (data === '\x1b[C') {
    // Right arrow - just pass through
  } else if (data === '\x1b[D') {
    // Left arrow - just pass through
  } else if (data === '\x03') {
    // Ctrl+C
    output += '^C\r\n' + getPrompt(session);
    session.buffer = '';
  } else if (data === '\x0c') {
    // Ctrl+L - clear screen
    output += '\x1b[2J\x1b[H' + getPrompt(session) + session.buffer;
  } else if (data === '\t') {
    // Tab - simple completion
    output += '    ';
    session.buffer += '    ';
  } else if (data.length === 2 && data[1] === ':') {
    // Drive letter (e.g., "d:")
    output += processCommand(data, session);
  } else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
    // Printable character
    session.buffer += data;
    output += data;
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
        const session = sessions.get(msg.sessionId);
        ws.send(JSON.stringify({
          type: 'session:output',
          sessionId: msg.sessionId,
          payload: { data: '\x1b[2J\x1b[HMicrosoft Windows [Version 10.0.19045.3803]\r\n(c) Microsoft Corporation. All rights reserved.\r\n\r\n' + getPrompt(session!) },
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