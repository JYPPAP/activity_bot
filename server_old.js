const express = require('express');
const server = express();
const port = 3000;
server.get('/', (req, res) => {
    res.send('bot state: online');
});

function keepAlive() {
    server.listen(port, () => {
        console.log('server online');
    });
}

module.exports = keepAlive;
