import express from 'express'
import net from 'node:net'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { appSettings } from '../shared/app-settings.ts'
import type { ClientMessage, ConnectionStatus, MudState, ServerMessage } from '../shared/mud.ts'

// Telnet constants (basic negotiation only, not MSDP)
const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240
const TTYPE_IS = 0
const TTYPE_SEND = 1
const TELOPT_ECHO = 1
const TELOPT_SGA = 3
const TELOPT_TTYPE = 24
const TELOPT_NAWS = 31
const TELOPT_CHARSET = 42
const TELOPT_MCCP = 86
const TELOPT_MXP = 91

const WEB_CLIENT_NAME = 'ThresholdrpgWebClient'
const WEB_CLIENT_VERSION = '0.1.0'
const DEFAULT_COLUMNS = 120
const DEFAULT_ROWS = 40

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientDist = path.resolve(__dirname, '../client')

app.get('/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/settings', (_request, response) => {
  response.json(appSettings)
})

app.use(express.static(clientDist))

app.get(/^(?!\/ws).*/, (_request, response) => {
  response.sendFile(path.join(clientDist, 'index.html'))
})

wss.on('connection', (socket) => {
  const session = new MudSession(socket)

  socket.on('message', (data) => {
    const message = parseClientMessage(data)
    if (!message) {
      session.sendStatus('error', 'Received an invalid browser message.')
      return
    }

    if (message.type === 'connect') {
      session.connect(message.host, message.port)
      return
    }

    if (message.type === 'disconnect') {
      session.disconnect('Disconnected.')
      return
    }

    session.sendInput(message.text)
  })

  socket.on('close', () => {
    session.disconnect('Disconnected.')
  })
})

const port = Number(process.env.PORT ?? appSettings.ports.server)
server.listen(port, () => {
  console.log(`ThresholdrpgWebClient proxy listening on http://localhost:${port}`)
})

class MudSession {
  private mudSocket: net.Socket | null = null
  private parser: TelnetParser | null = null
  private state: MudState = {}
  private gmcpInitialized = false
  private readonly browserSocket: WebSocket

  constructor(browserSocket: WebSocket) {
    this.browserSocket = browserSocket
  }

  connect(host: string, port: number) {
    if (!isValidHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.sendStatus('error', 'Provide a valid MUD host and port.')
      return
    }

    this.disconnect('Disconnected.')
    this.state = {}
    this.gmcpInitialized = false
    this.sendStatus('connecting', `Connecting to ${host}:${port}...`)

    const mudSocket = net.createConnection({ host, port })
    this.mudSocket = mudSocket
    this.parser = new TelnetParser(mudSocket, {
      onText: (text) => {
        this.send({ type: 'terminal', text })
      },
      onGmcp: (module, payload) => {
        this.handleGmcp(module, payload)
      },
      onGmcpReady: () => {
        if (this.gmcpInitialized) {
          return
        }
        this.gmcpInitialized = true
        this.initializeGmcp()
      },
    })

    mudSocket.setNoDelay(true)

    mudSocket.on('connect', () => {
      this.sendStatus('connected', `Connected to ${host}:${port}.`)
    })

    mudSocket.on('data', (chunk) => {
      this.parser?.push(chunk)
    })

    mudSocket.on('error', (error) => {
      this.sendStatus('error', `Connection error: ${error.message}`)
    })

    mudSocket.on('close', () => {
      this.cleanupSocket()
      this.sendStatus('disconnected', `Connection to ${host}:${port} closed.`)
    })
  }

  disconnect(detail: string) {
    if (this.mudSocket) {
      this.mudSocket.destroy()
    }

    this.cleanupSocket()
    this.state = {}
    this.sendStatus('disconnected', detail)
  }

  sendInput(text: string) {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      this.sendStatus('error', 'Connect to a MUD before sending commands.')
      return
    }

    this.mudSocket.write(text.endsWith('\n') ? text : `${text}\n`)
  }

  sendStatus(status: ConnectionStatus, detail: string) {
    this.send({ type: 'connection-status', status, detail })
  }

  private initializeGmcp() {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return
    }

    this.sendGmcp('Core.Hello', {
      client: WEB_CLIENT_NAME,
      version: WEB_CLIENT_VERSION,
    })

    this.sendGmcp('Core.Supports.Set', [
      'Char 1',
      'Char.Vitals 1',
      'Char.Buffs 1',
      'Char.Debuffs 1',
      'Core 1',
    ])

    this.sendGmcp('Char.Buffs.List', null)
    this.sendGmcp('Char.Debuffs.List', null)
  }

  private sendGmcp(module: string, payload: unknown) {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return
    }

    let message: string
    if (payload === null) {
      message = module
    } else {
      message = `${module} ${JSON.stringify(payload)}`
    }

    // GMCP is sent as: IAC SB 201 message IAC SE
    const encoded = Buffer.from(message, 'utf8')
    const gmcpBytes = [IAC, SB, 201] // 201 is GMCP telnet option
    gmcpBytes.push(...encoded)
    gmcpBytes.push(IAC, SE)

    this.mudSocket.write(Buffer.from(gmcpBytes))
  }

  private handleGmcp(module: string, payload: string) {
    const partial: Partial<MudState> = {}

    try {
      if (module === 'Char.StatusVars') {
        // Char.StatusVars tells us what variables are available
        // We don't need to store this, just acknowledge it
        return
      }

      if (module === 'Char.Status') {
        const status = JSON.parse(payload) as Record<string, string | undefined>
        // Map GMCP status fields to our state
        assignIfDefined(partial, 'name', status.name)
        assignIfDefined(partial, 'fullname', status.fullname)
        if (status.level !== undefined) {
          const parsedLevel = Number.parseInt(status.level, 10)
          if (Number.isFinite(parsedLevel)) {
            partial.level = parsedLevel
          }
        }
        assignIfDefined(partial, 'race', status.race)
        assignIfDefined(partial, 'gender', status.gender)
        assignIfDefined(partial, 'guild', status.guild)
        assignIfDefined(partial, 'lodge', status.lodge)
        assignIfDefined(partial, 'heritage', status.heritage)
        assignIfDefined(partial, 'age', status.age)
        assignIfDefined(partial, 'bank', status.bank)
        assignIfDefined(partial, 'hb', status.hb)
        assignIfDefined(partial, 'capacity', status.capacity)
        assignIfDefined(partial, 'max_capacity', status.max_capacity)
        assignIfDefined(partial, 'expertise', status.expertise)
        assignIfDefined(partial, 'xp', status.xp)
        assignIfDefined(partial, 'tnl', status.tnl)
        assignIfDefined(partial, 'tummy', status.tummy)
        assignIfDefined(partial, 'morality', status.morality)
        assignIfDefined(partial, 'harmonic', status.harmonic)
        assignIfDefined(partial, 'hlevel', status.hlevel)
        assignIfDefined(partial, 'guild_level', status.guild_level)
        assignIfDefined(partial, 'lodge_level', status.lodge_level)
        assignIfDefined(partial, 'inactive', status.inactive)
        assignIfDefined(partial, 'inactive_type', status.inactive_type)
        assignIfDefined(partial, 'invis', status.invis)
        assignIfDefined(partial, 'session_login', status.session_login)
        assignIfDefined(partial, 'dead', status.dead)
        assignIfDefined(partial, 'primary_axis', status.primary_axis)
        assignIfDefined(partial, 'foe_name', status.foe_name)
        assignIfDefined(partial, 'foe_health', status.foe_health)
        assignIfDefined(partial, 'foe_max_health', status.foe_max_health)
        assignIfDefined(partial, 'foe_foe_name', status.foe_foe_name)
      }

      if (module === 'Char.Vitals') {
        const vitals = JSON.parse(payload) as Record<string, string | undefined>
        partial.hp = vitals.hp
        partial.sp = vitals.sp
        partial.ep = vitals.ep
        partial.maxhp = vitals.maxhp
        partial.maxsp = vitals.maxsp
        partial.maxep = vitals.maxep
      }

      if (module === 'Char.Afflictions.Add') {
        const affliction = JSON.parse(payload) as string
        if (!this.state.afflictions) {
          this.state.afflictions = {}
        }
        this.state.afflictions[affliction as keyof typeof this.state.afflictions] = true
        partial.afflictions = this.state.afflictions
      }

      if (module === 'Char.Afflictions.Remove') {
        const affliction = JSON.parse(payload) as string
        if (!this.state.afflictions) {
          this.state.afflictions = {}
        }
        this.state.afflictions[affliction as keyof typeof this.state.afflictions] = false
        partial.afflictions = this.state.afflictions
      }

      if (module === 'Char.Buffs.Add') {
        const buff = JSON.parse(payload) as { buff_id: string; name: string; expires: string }
        if (!this.state.buffs) {
          this.state.buffs = {}
        }
        this.state.buffs[buff.buff_id] = {
          buff_id: buff.buff_id,
          name: buff.name,
          expires: buff.expires,
        }
        partial.buffs = this.state.buffs
      }

      if (module === 'Char.Buffs.Remove') {
        const buffId = JSON.parse(payload) as string
        if (this.state.buffs) {
          delete this.state.buffs[buffId]
          partial.buffs = this.state.buffs
        }
      }

      if (module === 'Char.Buffs.List') {
        const buffs = JSON.parse(payload) as Record<string, { name: string; expires: string }>
        this.state.buffs = {}
        for (const [id, buff] of Object.entries(buffs)) {
          this.state.buffs[id] = {
            buff_id: id,
            name: buff.name,
            expires: buff.expires,
          }
        }
        partial.buffs = this.state.buffs
      }

      if (module === 'Char.Debuffs.Add') {
        const debuff = JSON.parse(payload) as { debuff_id: string; name: string; expires: string }
        if (!this.state.debuffs) {
          this.state.debuffs = {}
        }
        this.state.debuffs[debuff.debuff_id] = {
          debuff_id: debuff.debuff_id,
          name: debuff.name,
          expires: debuff.expires,
        }
        partial.debuffs = this.state.debuffs
      }

      if (module === 'Char.Debuffs.Remove') {
        const debuffId = JSON.parse(payload) as string
        if (this.state.debuffs) {
          delete this.state.debuffs[debuffId]
          partial.debuffs = this.state.debuffs
        }
      }

      if (module === 'Char.Debuffs.List') {
        const debuffs = JSON.parse(payload) as Record<string, { name: string; expires: string }>
        this.state.debuffs = {}
        for (const [id, debuff] of Object.entries(debuffs)) {
          this.state.debuffs[id] = {
            debuff_id: id,
            name: debuff.name,
            expires: debuff.expires,
          }
        }
        partial.debuffs = this.state.debuffs
      }

      if (Object.keys(partial).length === 0) {
        return
      }

      this.state = { ...this.state, ...partial }
      this.send({ type: 'state', state: partial })
    } catch (error) {
      console.error(`Failed to parse GMCP module ${module}:`, error)
    }
  }

  private cleanupSocket() {
    this.parser = null
    this.mudSocket = null
    this.gmcpInitialized = false
  }

  private send(message: ServerMessage) {
    if (this.browserSocket.readyState !== WebSocket.OPEN) {
      return
    }

    this.browserSocket.send(JSON.stringify(message))
  }
}

function assignIfDefined<K extends keyof MudState>(target: Partial<MudState>, key: K, value: MudState[K] | undefined) {
  if (value !== undefined) {
    target[key] = value
  }
}

type TelnetParserCallbacks = {
  onText: (text: string) => void
  onGmcp: (module: string, payload: string) => void
  onGmcpReady: () => void
}

type ParserState = 'data' | 'iac' | 'iac-command' | 'sb-option' | 'sb-data' | 'sb-iac'

class TelnetParser {
  private state: ParserState = 'data'
  private readonly decoder = new StringDecoder('utf8')
  private readonly textBuffer: number[] = []
  private readonly sbBuffer: number[] = []
  private pendingCommand = 0
  private currentSbOption = 0
  private readonly socket: net.Socket
  private readonly callbacks: TelnetParserCallbacks
  private gmcpReady = false

  constructor(socket: net.Socket, callbacks: TelnetParserCallbacks) {
    this.socket = socket
    this.callbacks = callbacks
  }

  push(chunk: Buffer) {
    for (const byte of chunk) {
      this.consume(byte)
    }

    this.flushText()
  }

  private consume(byte: number) {
    if (this.state === 'data') {
      if (byte === IAC) {
        this.flushText()
        this.state = 'iac'
        return
      }

      this.textBuffer.push(byte)
      return
    }

    if (this.state === 'iac') {
      if (byte === IAC) {
        this.textBuffer.push(IAC)
        this.state = 'data'
        return
      }

      if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
        this.pendingCommand = byte
        this.state = 'iac-command'
        return
      }

      if (byte === SB) {
        this.state = 'sb-option'
        return
      }

      this.state = 'data'
      return
    }

    if (this.state === 'iac-command') {
      this.handleNegotiation(this.pendingCommand, byte)
      this.state = 'data'
      return
    }

    if (this.state === 'sb-option') {
      this.currentSbOption = byte
      this.sbBuffer.length = 0
      this.state = 'sb-data'
      return
    }

    if (this.state === 'sb-data') {
      if (byte === IAC) {
        this.state = 'sb-iac'
        return
      }

      this.sbBuffer.push(byte)
      return
    }

    if (byte === SE) {
      this.handleSubnegotiation(this.currentSbOption, Buffer.from(this.sbBuffer))
      this.sbBuffer.length = 0
      this.state = 'data'
      return
    }

    if (byte === IAC) {
      this.sbBuffer.push(IAC)
    }

    this.state = 'sb-data'
  }

  private flushText() {
    if (this.textBuffer.length === 0) {
      return
    }

    const text = this.decoder.write(Buffer.from(this.textBuffer))
    this.textBuffer.length = 0

    if (text) {
      this.callbacks.onText(text)
    }
  }

  private handleNegotiation(command: number, option: number) {
    if (command === WILL) {
      // GMCP is option 201
      if (option === 201) {
        this.sendNegotiation(DO, option)
        if (!this.gmcpReady) {
          this.gmcpReady = true
          this.callbacks.onGmcpReady()
        }
        return
      }

      if (option === TELOPT_ECHO || option === TELOPT_SGA) {
        this.sendNegotiation(DO, option)
        return
      }

      if (option === TELOPT_MCCP) {
        this.sendNegotiation(DONT, option)
        return
      }

      this.sendNegotiation(DONT, option)
      return
    }

    if (command === DO) {
      if (option === TELOPT_TTYPE) {
        this.sendNegotiation(WILL, option)
        return
      }

      if (option === TELOPT_NAWS) {
        this.sendNegotiation(WILL, option)
        this.sendNaws(DEFAULT_COLUMNS, DEFAULT_ROWS)
        return
      }

      if (option === TELOPT_CHARSET || option === TELOPT_MXP) {
        this.sendNegotiation(WONT, option)
        return
      }

      this.sendNegotiation(WONT, option)
    }
  }

  private handleSubnegotiation(option: number, payload: Buffer) {
    // GMCP is option 201
    if (option === 201) {
      const message = Buffer.from(payload).toString('utf8')
      const spaceIndex = message.indexOf(' ')
      const module = spaceIndex === -1 ? message : message.substring(0, spaceIndex)
      const payloadStr = spaceIndex === -1 ? '' : message.substring(spaceIndex + 1)

      this.callbacks.onGmcp(module, payloadStr)
      return
    }

    if (option === TELOPT_TTYPE && payload[0] === TTYPE_SEND) {
      this.socket.write(
        Buffer.concat([
          Buffer.from([IAC, SB, TELOPT_TTYPE, TTYPE_IS]),
          Buffer.from(WEB_CLIENT_NAME, 'utf8'),
          Buffer.from([IAC, SE]),
        ]),
      )
    }
  }

  private sendNegotiation(command: number, option: number) {
    this.socket.write(Buffer.from([IAC, command, option]))
  }

  private sendNaws(columns: number, rows: number) {
    const width = Buffer.from([columns >> 8, columns & 0xff])
    const height = Buffer.from([rows >> 8, rows & 0xff])
    this.socket.write(Buffer.concat([Buffer.from([IAC, SB, TELOPT_NAWS]), width, height, Buffer.from([IAC, SE])]))
  }
}

function parseClientMessage(data: RawData): ClientMessage | null {
  const text = dataToString(data)
  if (!text) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const message = parsed as Record<string, unknown>

    if (message.type === 'connect' && typeof message.host === 'string' && typeof message.port === 'number') {
      return {
        type: 'connect',
        host: message.host,
        port: message.port,
      }
    }

    if (message.type === 'disconnect') {
      return { type: 'disconnect' }
    }

    if (message.type === 'input' && typeof message.text === 'string') {
      return { type: 'input', text: message.text }
    }

    return null
  } catch {
    return null
  }
}

function dataToString(data: RawData) {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof Buffer) {
    return data.toString('utf8')
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  return ''
}

function isValidHost(host: string) {
  return /^[a-z0-9.-]+$/i.test(host) || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
}
