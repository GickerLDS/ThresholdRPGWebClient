export type MudValue =
  | string
  | number
  | boolean
  | null
  | MudValue[]
  | {
      [key: string]: MudValue
    }

// GMCP Status Variables available from Threshold RPG
export interface CharacterStatus {
  name?: string
  fullname?: string
  level?: number
  race?: string
  gender?: string
  guild?: string
  lodge?: string
  heritage?: string
  age?: string
  bank?: string
  hb?: string
  capacity?: string
  max_capacity?: string
  expertise?: string
  xp?: string
  tnl?: string
  tummy?: string
  morality?: string
  harmonic?: string
  hlevel?: string
  guild_level?: string
  lodge_level?: string
  inactive?: string
  inactive_type?: string
  invis?: string
  session_login?: string
  dead?: string
  primary_axis?: string
  foe_name?: string
  foe_health?: string
  foe_max_health?: string
  foe_foe_name?: string
}

// GMCP Vitals
export interface CharacterVitals {
  hp?: string
  sp?: string
  ep?: string
  maxhp?: string
  maxsp?: string
  maxep?: string
  string?: string
}

// GMCP Buff/Debuff entry
export interface Effect {
  buff_id?: string
  debuff_id?: string
  name?: string
  expires?: string
}

// Combined MUD state from GMCP
export interface MudState {
  // Status variables
  name?: string
  fullname?: string
  level?: number
  race?: string
  gender?: string
  guild?: string
  lodge?: string
  heritage?: string
  age?: string
  bank?: string
  hb?: string
  capacity?: string
  max_capacity?: string
  expertise?: string
  xp?: string
  tnl?: string
  tummy?: string
  morality?: string
  harmonic?: string
  hlevel?: string
  guild_level?: string
  lodge_level?: string
  inactive?: string
  inactive_type?: string
  invis?: string
  session_login?: string
  dead?: string
  primary_axis?: string
  foe_name?: string
  foe_health?: string
  foe_max_health?: string
  foe_foe_name?: string

  // Vitals
  hp?: string
  sp?: string
  ep?: string
  maxhp?: string
  maxsp?: string
  maxep?: string

  // Afflictions (booleans)
  afflictions?: {
    blind?: boolean
    deaf?: boolean
    immobile?: boolean
    mute?: boolean
    stun?: boolean
  }

  // Buffs and Debuffs
  buffs?: Record<string, Effect>
  debuffs?: Record<string, Effect>
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export type ClientMessage =
  | {
      type: 'connect'
      host: string
      port: number
    }
  | {
      type: 'disconnect'
    }
  | {
      type: 'input'
      text: string
    }

export type ServerMessage =
  | {
      type: 'connection-status'
      status: ConnectionStatus
      detail: string
    }
  | {
      type: 'terminal'
      text: string
    }
  | {
      type: 'state'
      state: Partial<MudState>
    }
