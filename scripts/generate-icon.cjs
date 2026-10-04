const { app, BrowserWindow } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  const svg = await readFile(path.join(__dirname, '../build/icon.svg'), 'utf8');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<html></html>');
  const data = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image(); image.src = ${JSON.stringify('data:image/svg+xml;base64,' )} + ${JSON.stringify(Buffer.from(svg).toString('base64'))}; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    canvas.getContext('2d').drawImage(image, 0, 0, 1024, 1024); return canvas.toDataURL('image/png').split(',')[1];
  })()`);
  await writeFile(path.join(__dirname, '../build/icon.png'), Buffer.from(data, 'base64'));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
