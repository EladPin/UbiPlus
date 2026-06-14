const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let mainWindow = null;
let serverProcess = null;
let serverReady = false;

function startServer() {
  serverProcess = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'server.ps1'),
    '-NoLaunch'
  ], { detached: false, stdio: 'ignore' });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err);
  });
}

// Use taskkill /F /T to kill the entire PowerShell process tree.
// Node's .kill() only kills the direct process on Windows; child processes
// (plink, etc.) and the PowerShell host can linger and hold the port open.
function killServer() {
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  serverProcess = null;
  try {
    const tk = spawn('taskkill', ['/F', '/T', '/PID', String(pid)],
      { detached: true, stdio: 'ignore' });
    tk.unref();
  } catch {}
}

function waitForServer(cb, tries = 0) {
  if (serverReady) return;
  http.get('http://localhost:8093/ubiplus/', res => {
    res.resume(); // drain so socket closes cleanly
    if (!serverReady) { serverReady = true; cb(); }
  }).on('error', () => {
    if (!serverReady && tries < 40) {
      setTimeout(() => waitForServer(cb, tries + 1), 400);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    title: 'UbiPlus',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL('http://localhost:8093/ubiplus/');
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
    killServer();
  });
}

app.on('ready', () => {
  startServer();
  waitForServer(createWindow);
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null && serverReady) {
    createWindow();
  }
});
