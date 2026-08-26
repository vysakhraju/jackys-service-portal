const { io } = require('socket.io-client');

const token = process.argv[2];
if (!token) {
  console.error('Usage: node reports-ws-test.js <jwt>');
  process.exit(1);
}

const socket = io('http://localhost:3000/reports', {
  auth: { token },
  transports: ['websocket'],
  reconnection: false,
  timeout: 8000,
});

let gotKanban = false;
let gotAging = false;

const finish = (code) => {
  socket.close();
  console.log(JSON.stringify({ gotKanban, gotAging, code }));
  process.exit(code);
};

socket.on('connect', () => {
  console.log('CONNECTED', socket.id);
});

socket.on('kanban:update', (payload) => {
  gotKanban = true;
  console.log('KANBAN_UPDATE totalActiveJobs=' + payload.totalActiveJobs + ' columns=' + payload.columns.length);
  if (gotAging) finish(0);
});

socket.on('approval-aging:update', (payload) => {
  gotAging = true;
  console.log('APPROVAL_AGING_UPDATE breachedCount=' + payload.breachedCount);
  if (gotKanban) finish(0);
});

socket.on('error', (err) => {
  console.error('SOCKET_ERROR', err);
});

socket.on('connect_error', (err) => {
  console.error('CONNECT_ERROR', err.message);
  finish(1);
});

socket.on('disconnect', (reason) => {
  console.log('DISCONNECTED', reason);
});

setTimeout(() => {
  console.error('TIMEOUT waiting for events', { gotKanban, gotAging });
  finish(gotKanban && gotAging ? 0 : 2);
}, 10000);
