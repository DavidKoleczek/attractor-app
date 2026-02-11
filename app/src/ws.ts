type EventHandler = (data: unknown) => void

class WS {
  private socket: WebSocket | null = null
  private listeners: Map<string, Set<EventHandler>> = new Map()
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect(): void {
    this.shouldReconnect = true
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    const url = `${proto}//${location.host}/ws`
    const socket = new WebSocket(url)

    socket.onopen = () => {
      this.reconnectDelay = 1000
    }

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { event: string; data: unknown }
        const handlers = this.listeners.get(msg.event)
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(msg.data)
            } catch {
              // handler error, ignore
            }
          }
        }
      } catch {
        // malformed message, ignore
      }
    }

    socket.onclose = () => {
      this.socket = null
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            this.maxReconnectDelay,
          )
          this.connect()
        }, this.reconnectDelay)
      }
    }

    socket.onerror = () => {
      socket.close()
    }

    this.socket = socket
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  on(event: string, handler: EventHandler): () => void {
    let handlers = this.listeners.get(event)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(event, handlers)
    }
    handlers.add(handler)
    return () => {
      handlers!.delete(handler)
      if (handlers!.size === 0) {
        this.listeners.delete(event)
      }
    }
  }
}

export const ws = new WS()
