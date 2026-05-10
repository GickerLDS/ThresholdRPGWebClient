export type MudPreset = {
  id: string
  name: string
  host: string
  port: number
  description?: string
}

export type AppSettings = {
  ports: {
    client: number
    server: number
    preview: number
  }
  connection: {
    defaultHost: string
    defaultPort: number
    muds: MudPreset[]
  }
  personalization: {
    browserTitle: string
    eyebrow: string
    title: string
    subtitle: string
  }
}

export const appSettings: AppSettings = {
  ports: {
    client: 5174,
    server: 3211,
    preview: 4174,
  },
  connection: {
    defaultHost: 'thresholdrpg.com',
    defaultPort: 3333,
    muds: [
      {
        id: 'threshold',
        name: 'ThresholdRPG',
        host: 'thresholdrpg.com',
        port: 3333,
        description: 'Threshold is a high fantasy, real-time, multi-player, online role playing game.',
      },
    ],
  },
  personalization: {
    browserTitle: 'ThresholdRPG Web Client',
    eyebrow: '',
    title: 'ThresholdRPG Web Client',
    subtitle:
      '',
  },
}
