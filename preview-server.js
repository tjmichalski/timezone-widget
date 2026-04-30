const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const BASE = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

http.createServer((req, res) => {
  let url = req.url === '/' ? '/index.html' : req.url;
  const file = path.join(BASE, url.split('?')[0]);
  const ext  = path.extname(file);

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving on http://localhost:${PORT}`));
