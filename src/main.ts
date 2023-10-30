import { copy } from 'fs-extra'
import { join, parse } from 'node:path'
import { App, FileSystemAdapter, Plugin } from 'obsidian'

interface PluginManifest {
  id: string
  dir: string
}

interface PluginCollection {
  manifests: Record<string, PluginManifest>
  enabledPlugins: Set<string>
  disablePlugin(plugin: string): Promise<void>
  enablePlugin(plugin: string): Promise<void>
}

interface GlobalApp extends App {
  plugins: PluginCollection
}

interface PluginFileConfig {
  source: string
  destination: string
}

interface PluginConfig {
  id: string
  files: (string | PluginFileConfig)[] | null | undefined
}

interface Config {
  reloadButtonIcon: string | null | undefined
  plugins: PluginConfig[] | null | undefined
}

function log(message: string) {
  console.log(`[Plugin Update Button] ${message}`)
}

const SOURCE_MAP_PROPERTY_NAME = 'debug-plugin'

export default class PluginUpdateButton extends Plugin {
  async onload() {
    const adapter = this.app.vault.adapter
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error('Unsupported vault storage adapter')
    }
    const config: Config = await this.loadData()
    this.app.workspace.onLayoutReady(() => {
      this.addRibbonIcon(config.reloadButtonIcon || 'refresh-ccw', 'Update Workspace Plugins', () => {
        this.updatePlugins(this.app as GlobalApp, adapter.getBasePath(), this.app.vault.configDir).catch(console.error)
      })
      log('Loaded')
    })
  }

  private async updatePlugins(app: GlobalApp, vaultPath: string, configDir: string) {
    const { plugins: pluginConfigs }: Config = await this.loadData()
    for (const manifest of Object.values(app.plugins.manifests)) {
      const pluginConfig = (pluginConfigs || []).find(({ id }) => id === manifest.id)
      if (pluginConfig) {
        const pluginPath = join(vaultPath, configDir, parse(manifest.dir).base)
        try {
          if (pluginConfig.files && pluginConfig.files.length > 0) {
            log(`Updating files for ${manifest.id}`)
            for (const file of pluginConfig.files) {
              const sourcePath = typeof file === 'string' ? file : file.source
              const destinationPath = typeof file === 'string'
                ? join(pluginPath, parse(file).base)
                : file.destination
              log(`Copying ${sourcePath} to ${destinationPath}`)
              await copy(sourcePath, destinationPath)
            }
          }
          log(`Reloading ${manifest.id}`)
          await this.reloadPlugin(app.plugins, manifest.id)
        } catch (error) {
          console.error(error)
        }
      }
    }
    log('Plugins reloaded')
  }

  /**
   * This function is derived from the one in the official(?) Hot Reload plugin.
   * The original code is Copyright 2023 PJ Eby and is available here:
   * https://github.com/pjeby/hot-reload/blob/fe57f9ea63c49b78ea0d0d426b68abf39d539016/main.js#L89
   */
  private async reloadPlugin(plugins: PluginCollection, pluginName: string) {
    if (!plugins.enabledPlugins.has(pluginName)) {
      return
    }
    await plugins.disablePlugin(pluginName)
    /* Load sourcemaps in Obsidian 14+ */
    const oldDebug = localStorage.getItem(SOURCE_MAP_PROPERTY_NAME)
    localStorage.setItem(SOURCE_MAP_PROPERTY_NAME, '1')
    try {
      await plugins.enablePlugin(pluginName)
    } finally {
      /* Restore previous setting */
      if (oldDebug === null) {
        localStorage.removeItem(SOURCE_MAP_PROPERTY_NAME)
      } else {
        localStorage.setItem(SOURCE_MAP_PROPERTY_NAME, oldDebug)
      }
    }
  }
}
