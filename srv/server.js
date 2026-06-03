const cds = require('@sap/cds');
const express = require('express');

// Raise the request body size limit so base64 attachments (chat files,
// documents — up to ~13 MB for a 10 MB file) aren't rejected with HTTP 413
// "request entity too large". Registered in bootstrap so it runs before the
// protocol adapters' parsers; once it has parsed the body, theirs skip it.
cds.on('bootstrap', (app) => {
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));
});

module.exports = cds.server;
