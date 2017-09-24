const bodyParser = require('body-parser')
const request = require('request-promise-native')

let accessToken = null
let router = null

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
    app.post('/facebook/messenger', function (req, res) {
      const data = req.body
      if (data.object === 'page') {
        data.entry.forEach(entry => {
          entry.messaging.forEach(event => {
            const sender = event.sender.id
            const text = event.message.text
            if (!text) {
              res.sendStatus(200).send('Only supporting text for now')
              return
            }

            // TODO check if a password is configured

            let message = {input: text, metadata: {senderId: sender}}
            router.heard(message)
            res.sendStatus(200).send('Ok')
          })
        })
      }
    })
    resolve()
  })
}

function clientStart (config, clientRouter) {
  return new Promise(function (resolve, reject) {
    router = clientRouter
    resolve({speak: speak})
  })
}

function speak (message) {
  let senderId = message.metadata.sender
  return sendMessage(senderId, message.output)
}

/** See the Send API reference
 * https://developers.facebook.com/docs/messenger-platform/send-api-reference
 * @return {Promise}
 */
function sendMessage (id, text) {
  const body = {
    recipient: { id },
    message: { text }
  }

  const qs = 'access_token=' + encodeURIComponent(accessToken)
  return request.post('https://graph.facebook.com/me/messages?' + qs, body)
}

module.exports = {client: clientStart, http: httpStart}
