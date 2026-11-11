import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const bridge = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]): void => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  reply: (channel: string, id: string, result: unknown): void => ipcRenderer.send(`${channel}:reply:${id}`, result)
}

contextBridge.exposeInMainWorld('bridge', bridge)

export type Bridge = typeof bridge
