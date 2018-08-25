const bodyParser = require('body-parser');
const request = require('request-promise-native');
const debug = require('debug')('genie-router-plugin-facebook-messenger:messenger');
const crypto = require('crypto');

let accessToken = null;
let router = null;
let routerFunctions;
let passwordRequired = false;
let configuredPassword;
const allowedSenderIds = {};

/** See the Send API reference
 * https://developers.facebook.com/docs/messenger-platform/send-api-reference
 * @return {Promise}
 */
async function sendMessage(id, text) {
    const body = {
        recipient: { id },
        message: { text },
    };
    const qs = `access_token=${encodeURIComponent(accessToken)}`;
    return request({
        url: `https://graph.facebook.com/v3.1/me/messages?${qs}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        json: body,
    });
}

function whitelistSenderId(senderId) {
    allowedSenderIds[senderId] = true;
    routerFunctions.storage.put(senderId, crypto.createHash('sha256').update(senderId + configuredPassword).digest('base64'));
}

function isSenderIdWhiteListed(senderId) {
    return allowedSenderIds[senderId] === true;
}

function speak(message) {
    const senderId = message.userId;
    return sendMessage(senderId, message.output);
}

async function clientStart(config, clientRouter) {
    router = clientRouter;
    return { speak };
}

async function isChattingAllowed(senderId) {
    if (!passwordRequired) {
        return true;
    } if (isSenderIdWhiteListed(senderId)) {
        return true;
    }

    // check if persistent storage has already seen this user earlier.
    const storedValue = await routerFunctions.storage.get(senderId, false);
    if (storedValue === false) {
        return false;
    }

    const check = crypto.createHash('sha256').update(senderId + configuredPassword).digest('base64');
    return check === storedValue;
}

async function handleMessage(sender, text) {
    // check if the user is authorized
    if (passwordRequired && text === configuredPassword) {
        whitelistSenderId(sender);
        sendMessage(sender, 'Access is granted.');
        return;
    }

    const allowed = await isChattingAllowed(sender);
    if (!allowed) {
        sendMessage(sender, 'Please send me the password first.');
        return;
    }

    const message = { input: text, userId: sender };
    router.heard(message);
}

async function httpStart(config, app) {
    if (!config.verifyToken) {
        throw new Error('No verifyToken configured.');
    }
    if (!config.accessToken) {
        throw new Error('No accessToken configured.');
    }
    accessToken = config.accessToken; // eslint-disable-line prefer-destructuring

    if (config.password) {
        passwordRequired = true;
        configuredPassword = config.password;
        debug('FB Messenger client is protected with a password.');
    }

    // configure bodyparser
    app.use(bodyParser.json());

    // respond to a valid verifyToken
    app.get('/facebook/messenger', (req, res) => {
        if (req.query['hub.mode'] === 'subscribe'
            && req.query['hub.verify_token'] === config.verifyToken
        ) {
            res.send(req.query['hub.challenge']);
        } else {
            res.sendStatus(400);
        }
    });

    // incoming message
    debug('Incoming FB message');
    app.post('/facebook/messenger', (req, res) => {
        const data = req.body;
        if (data.object === 'page') {
            data.entry.forEach((entry) => {
                entry.messaging.forEach(async (event) => {
                    const sender = event.sender.id;
                    const { text } = event.message;
                    if (!text) {
                        debug('Ignoring non-text message from', sender);
                    } else {
                        debug('Incoming text message from', sender, text);
                        await handleMessage(sender, text);
                    }
                });
            });
        }
        res.status(200).send('Ok'); // immediately send the ok response
    });
}

module.exports = {
    client: { start: clientStart },
    http: { start: httpStart },
    setRouter: (routerFunc) => {
        routerFunctions = routerFunc;
    },
};
