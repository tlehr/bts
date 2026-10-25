'use strict';

// Configuration and signing keys travel through private IPC, never argv.
// A stopped/crashed parent must not leave an audio server behind.
process.on('disconnect', () => process.exit(0));
process.once('uncaughtException', error => {
    const failure = { message: String(error.message).slice(0, 240), code: error.code,
        stack: String(error.stack || error).slice(0, 8192) };
    if (!process.connected) process.exit(1);
    process.send({ type: 'fatal', error: failure }, () => process.exit(1));
    setTimeout(() => process.exit(1), 100).unref();
});
process.once('message', message => {
    if (message?.type !== 'initialize') throw new Error('invalid_speech_initialization');
    const port = {
        on: (event, receive) => process.on(event, receive),
        postMessage(value) {
            if (process.connected) process.send(value, error => { if (error) process.exit(1); });
        },
    };
    require('./worker').start(port, message.workerData);
});
