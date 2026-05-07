import { spawn } from 'node:child_process';
console.log('hello from test mjs');
const c = spawn(process.platform==='win32'?'cmd.exe':'echo', process.platform==='win32'?['/c','echo child ok']:['child ok'], {stdio:'inherit'});
c.on('exit',()=>console.log('child done'));
