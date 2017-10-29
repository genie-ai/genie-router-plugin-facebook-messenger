const bodyParser = require('body-parser')
const request = require('request-promise-native')
const debug = require('debug')('genie-router-plugin-facebook-messenger:messenger')

let accessToken = null
let router = null
let passwordRequired = false
let configuredPassword
let allowedSenderIds = {}

function httpStart (config, app) {
  return new Promise(function (resolve, reject) {
    if (!config.verifyToken) {
      reject(new Error('No verifyToken configured.'))
      return
    }
    if (!config.accessToken) {
      reject(new Error('No accessToken configured.'))
      return
    }
    accessToken = config.accessToken

    if (config.password) {
      passwordRequired = true
      configuredPassword = config.password
      debug('FB Messenger client is protected with a password.')
    }

    // configure bodyparser
    app.use(bodyParser.json())

    // respond to a valid verifyToken
    app.get('/facebook/messenger', function (req, res) {
      if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === config.verifyToken) {
        res.send(req.query['hub.challenge'])
      } else {
        res.sendStatus(400)
      }
    })

    // incoming message
    debug('Incoming FB message')
    app.post('/facebook/messenger', function (req, res) {
      const data = req.body
      if (data.object === 'page') {
        data.entry.forEach(entry => {
          entry.messaging.forEach(event => {
            const sender = event.sender.id
            const text = event.message.text
            if (!text) {
              debug('Ignoring non-text message from', sender)
            } else {
              debug('Incoming text message from', sender, text)

              handleMessage(sender, text)
            }
          })
        })
      }
      res.status(200).send('Ok') // immediately send the ok response
    })
    resolve()
  })
}

function handleMessage (sender, text) {
  // check if the user is authorized
  if (passwordRequired && text === configuredPassword) {
    whitelistSenderId(sender)
    sendMessage(sender, 'Access is granted.')
    return
  }
  if (passwordRequired && !isSenderIdWhiteListed(sender)) {
    sendMessage(sender, 'Please send me the password first.')
    return
  }

  let message = {input: text, userId: sender}
  router.heard(message)
}

function whitelistSenderId (senderId) {
  allowedSenderIds[senderId] = true
}

function isSenderIdWhiteListed (senderId) {
  return allowedSenderIds[senderId] === true
}

function clientStart (config, clientRouter) {
  return new Promise(function (resolve, reject) {
    router = clientRouter
    resolve({speak: speak})
  })
}

function speak (message) {
  let senderId = message.userId
  return sendMessage(senderId, message.output)
}

/** See the Send API reference
 * https://developers.facebook.com/docs/messenger-platform/send-api-reference
 * @return {Promise}
 */
function sendMessage (id, text) {
  const body = {
    recipient: {id: id},
    message: {text: text}
  }
  const qs = 'access_token=' + encodeURIComponent(accessToken)
  return request({
    url: 'https://graph.facebook.com/me/messages?' + qs,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    json: body
  })
}

module.exports = {client: {start: clientStart}, http: {start: httpStart}}
